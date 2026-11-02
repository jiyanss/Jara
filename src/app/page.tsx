"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  Check,
  Clock,
  Dices,
  Image as ImageIcon,
  Moon,
  Search,
  Sun,
} from "lucide-react";
import { useTheme } from "next-themes";
import { Logo } from "@/components/search/logo";
import { SearchBar } from "@/components/search/search-bar";
import { WebResults, type WebResult } from "@/components/search/web-results";
import { ImageResults, type ImageItem } from "@/components/search/image-results";
import { AiOverview } from "@/components/search/ai-overview";
import { Pagination } from "@/components/search/pagination";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type Tab = "web" | "images";
type TimeFilter = "all" | "day" | "week" | "month" | "year";

interface WebResponse {
  q: string;
  page: number;
  time: string;
  total: number;
  hasMore: boolean;
  tookMs: number;
  results: WebResult[];
}

interface HistoryState {
  q: string;
  tab: Tab;
  page: number;
  time: TimeFilter;
}

const RECENTS_KEY = "ara:recent";
const MAX_RECENTS = 8;

const TRENDING = [
  "son dakika haberleri",
  "bitcoin fiyatı",
  "istanbul hava durumu",
  "en iyi filmler 2025",
  "yapay zeka nedir",
  "döviz kurları",
  "europa league",
  "tyt ne zaman",
];

const TIME_LABELS: Record<TimeFilter, string> = {
  all: "Tüm zamanlar",
  day: "Son 24 saat",
  week: "Son 1 hafta",
  month: "Son 1 ay",
  year: "Son 1 yıl",
};

function stateFromUrl(): HistoryState {
  const params = new URLSearchParams(window.location.search);
  const tab = params.get("tab");
  const time = params.get("time");
  return {
    q: params.get("q") || "",
    tab: tab === "images" ? "images" : "web",
    page: Math.max(1, parseInt(params.get("page") || "1", 10) || 1),
    time: (["all", "day", "week", "month", "year"].includes(time || "")
      ? time
      : "all") as TimeFilter,
  };
}

function buildUrl(state: HistoryState): string {
  const params = new URLSearchParams();
  if (state.q) {
    params.set("q", state.q);
    if (state.tab !== "web") params.set("tab", state.tab);
    if (state.page > 1) params.set("page", String(state.page));
    if (state.time !== "all") params.set("time", state.time);
  }
  const qs = params.toString();
  return qs ? `/?${qs}` : "/";
}

export default function Home() {
  const [ready, setReady] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const [activeQuery, setActiveQuery] = useState("");
  const [tab, setTab] = useState<Tab>("web");
  const [page, setPage] = useState(1);
  const [timeFilter, setTimeFilter] = useState<TimeFilter>("all");

  const [webData, setWebData] = useState<WebResponse | null>(null);
  const [webLoading, setWebLoading] = useState(false);
  const [webError, setWebError] = useState<string | null>(null);

  const [imageData, setImageData] = useState<ImageItem[]>([]);
  const [imageDataFor, setImageDataFor] = useState("");
  const [imageLoading, setImageLoading] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);

  const [recents, setRecents] = useState<string[]>([]);
  const [mounted, setMounted] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const webCacheRef = useRef<Map<string, { data: WebResponse; ts: number }>>(new Map());
  const imageCacheRef = useRef<Map<string, ImageItem[]>>(new Map());

  // ---- Initialization: read URL + recents, listen to popstate ----
  useEffect(() => {
    const state = stateFromUrl();
    setInputValue(state.q);
    setActiveQuery(state.q);
    setTab(state.tab);
    setPage(state.page);
    setTimeFilter(state.time);
    try {
      setRecents(JSON.parse(localStorage.getItem(RECENTS_KEY) || "[]"));
    } catch {
      setRecents([]);
    }
    setReady(true);
    setMounted(true);

    const onPop = () => {
      const s = stateFromUrl();
      setInputValue(s.q);
      setActiveQuery(s.q);
      setTab(s.tab);
      setPage(s.page);
      setTimeFilter(s.time);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // ---- Document title ----
  useEffect(() => {
    document.title = activeQuery
      ? `${activeQuery} — Jara!`
      : "Jara! — Gerçek Zamanlı Web Arama Motoru";
  }, [activeQuery]);

  // ---- State + URL synchronization ----
  // NOTE: no side effects inside state updater functions — history updates
  // happen in the callback body (event handler), never during render.
  const applyState = useCallback(
    (next: Partial<HistoryState>, replace: boolean) => {
      const merged: HistoryState = {
        q: next.q !== undefined ? next.q : activeQuery,
        tab: next.tab ?? tab,
        page: next.page ?? page,
        time: next.time ?? timeFilter,
      };
      const url = buildUrl(merged);
      if (replace) window.history.replaceState(merged, "", url);
      else window.history.pushState(merged, "", url);
      setActiveQuery(merged.q);
      if (next.tab !== undefined) setTab(next.tab);
      if (next.page !== undefined) setPage(next.page);
      if (next.time !== undefined) setTimeFilter(next.time);
    },
    [activeQuery, tab, page, timeFilter]
  );

  const addRecent = useCallback((q: string) => {
    setRecents((prev) => {
      const next = [q, ...prev.filter((r) => r.toLowerCase() !== q.toLowerCase())].slice(
        0,
        MAX_RECENTS
      );
      try {
        localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
      } catch {
        /* storage might be unavailable */
      }
      return next;
    });
  }, []);

  const clearRecents = useCallback(() => {
    setRecents([]);
    try {
      localStorage.removeItem(RECENTS_KEY);
    } catch {
      /* noop */
    }
  }, []);

  const runSearch = useCallback(
    (q: string) => {
      setInputValue(q);
      addRecent(q);
      applyState({ q, page: 1, tab: "web" }, false);
      window.scrollTo({ top: 0 });
    },
    [addRecent, applyState]
  );

  const switchTab = useCallback(
    (t: Tab) => {
      if (t === tab) return;
      applyState({ tab: t }, false);
      window.scrollTo({ top: 0 });
    },
    [applyState, tab]
  );

  const selectPage = useCallback(
    (p: number) => {
      applyState({ page: Math.max(1, p) }, false);
      window.scrollTo({ top: 0 });
    },
    [applyState]
  );

  const selectTime = useCallback(
    (t: TimeFilter) => {
      if (t === timeFilter) return;
      applyState({ time: t, page: 1 }, false);
      window.scrollTo({ top: 0 });
    },
    [applyState, timeFilter]
  );

  const goHome = useCallback(() => {
    setInputValue("");
    applyState({ q: "", page: 1, tab: "web", time: "all" }, false);
  }, [applyState]);

  // ---- Web results fetching ----
  const fetchWeb = useCallback(
    async (state: { q: string; page: number; time: TimeFilter }, force = false) => {
      const key = `${state.q.toLowerCase()}::${state.time}::${state.page}`;
      const cached = webCacheRef.current.get(key);
      if (cached && Date.now() - cached.ts < 60_000 && !force) {
        setWebData(cached.data);
        setWebError(null);
        setWebLoading(false);
        return;
      }
      setWebLoading(true);
      setWebError(null);
      try {
        const res = await fetch(
          `/api/search?q=${encodeURIComponent(state.q)}&page=${state.page}&time=${state.time}`
        );
        const json = (await res.json()) as WebResponse & { error?: string };
        if (!res.ok) throw new Error(json.error || "Arama başarısız oldu.");
        // Ignore stale responses (query/page/time changed while in flight)
        if (
          json.q.toLowerCase() !== state.q.toLowerCase() ||
          json.page !== state.page ||
          (json.time || "all") !== state.time
        ) {
          return;
        }
        setWebData(json);
        webCacheRef.current.set(key, { data: json, ts: Date.now() });
      } catch (err) {
        setWebData(null);
        setWebError(err instanceof Error ? err.message : "Bilinmeyen bir hata oluştu.");
      } finally {
        setWebLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    if (!ready || !activeQuery || tab !== "web") return;
    void fetchWeb({ q: activeQuery, page, time: timeFilter });
  }, [ready, activeQuery, tab, page, timeFilter, fetchWeb]);

  // ---- Image results fetching ----
  const fetchImages = useCallback(async (q: string, force = false) => {
    const key = q.toLowerCase();
    const cached = imageCacheRef.current.get(key);
    if (cached && !force) {
      setImageData(cached);
      setImageDataFor(q);
      setImageError(null);
      setImageLoading(false);
      return;
    }
    setImageLoading(true);
    setImageError(null);
    try {
      const res = await fetch(`/api/images?q=${encodeURIComponent(q)}`);
      const json = (await res.json()) as { results?: ImageItem[]; error?: string };
      if (!res.ok) throw new Error(json.error || "Görseller alınamadı.");
      const items = json.results || [];
      setImageData(items);
      setImageDataFor(q);
      imageCacheRef.current.set(key, items);
    } catch (err) {
      setImageData([]);
      setImageDataFor(q);
      setImageError(err instanceof Error ? err.message : "Bilinmeyen bir hata oluştu.");
    } finally {
      setImageLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!ready || !activeQuery || tab !== "images") return;
    void fetchImages(activeQuery);
  }, [ready, activeQuery, tab, fetchImages]);

  // ---- Retry handlers (defined after the fetch callbacks they reference) ----
  const retryWeb = useCallback(() => {
    setWebError(null);
    webCacheRef.current.clear();
    setWebData(null);
    setWebLoading(true);
    void fetchWeb({ q: activeQuery, page, time: timeFilter }, true);
  }, [activeQuery, page, timeFilter, fetchWeb]);

  const retryImages = useCallback(() => {
    setImageError(null);
    imageCacheRef.current.delete(activeQuery.toLowerCase());
    setImageData([]);
    void fetchImages(activeQuery, true);
  }, [activeQuery, fetchImages]);

  // ---- "/" focuses the search box ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        e.key === "/" &&
        document.activeElement?.tagName !== "INPUT" &&
        document.activeElement?.tagName !== "TEXTAREA"
      ) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ---- Derived ----
  const isResults = ready && activeQuery.length > 0;

  // Only show data that belongs to the current query/page/time (never stale data)
  const effectiveWeb =
    webData &&
    webData.q.toLowerCase() === activeQuery.toLowerCase() &&
    webData.page === page &&
    (webData.time || "all") === timeFilter
      ? webData
      : null;
  const webBusy = webLoading || (!!activeQuery && tab === "web" && !effectiveWeb && !webError);
  const stats = effectiveWeb
    ? `Yaklaşık ${effectiveWeb.total} sonuç · ${(effectiveWeb.tookMs / 1000).toFixed(2)} sn`
    : "";

  const effectiveImages = imageDataFor === activeQuery ? imageData : [];
  const imageBusy = imageLoading || (tab === "images" && imageDataFor !== activeQuery && !imageError);

  // ---- Render ----
  if (!ready) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-background">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.4 }}
        >
          <Logo className="h-[68px] w-auto" />
        </motion.div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {isResults ? (
        <>
          {/* ---------- Results header ---------- */}
          <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur">
            <div className="mx-auto flex w-full max-w-6xl items-center gap-3 px-4 py-3 md:gap-5">
              <button
                type="button"
                onClick={goHome}
                aria-label="Ana sayfaya dön"
                className="shrink-0"
              >
                <Logo className="h-6 md:h-[30px] w-auto" />
              </button>
              <SearchBar
                value={inputValue}
                onValueChange={setInputValue}
                onSubmit={runSearch}
                recents={recents}
                onClearRecents={clearRecents}
                inputRef={inputRef}
                className="mx-auto w-full max-w-2xl"
              />
              <ThemeToggle mounted={mounted} />
            </div>

            <div className="border-t">
              <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-4">
                <div role="tablist" aria-label="Arama türü" className="flex gap-1">
                  <TabButton
                    active={tab === "web"}
                    onClick={() => switchTab("web")}
                    layoutId="tab-underline"
                  >
                    <Search className="size-4" aria-hidden="true" />
                    Web
                  </TabButton>
                  <TabButton
                    active={tab === "images"}
                    onClick={() => switchTab("images")}
                    layoutId="tab-underline"
                  >
                    <ImageIcon className="size-4" aria-hidden="true" />
                    Görseller
                  </TabButton>
                </div>

                {tab === "web" && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="sm" className="gap-2 text-muted-foreground">
                        <Clock className="size-4" aria-hidden="true" />
                        <span className="hidden sm:inline">{TIME_LABELS[timeFilter]}</span>
                        <span className="sm:hidden">Zaman</span>
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {(Object.keys(TIME_LABELS) as TimeFilter[]).map((t) => (
                        <DropdownMenuItem key={t} onClick={() => selectTime(t)}>
                          <Check
                            className={`size-4 ${timeFilter === t ? "opacity-100" : "opacity-0"}`}
                            aria-hidden="true"
                          />
                          {TIME_LABELS[t]}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
            </div>
          </header>

          {/* ---------- Results body ---------- */}
          <main className="flex-1">
            {tab === "web" ? (
              <div className="mx-auto w-full max-w-2xl px-4 py-5">
                <p className="mb-5 text-xs text-muted-foreground" aria-live="polite">
                  {webBusy ? "Sonuçlar getiriliyor..." : stats}
                </p>

                {page === 1 && effectiveWeb && effectiveWeb.results.length > 0 && (
                  <AiOverview
                    key={activeQuery}
                    query={activeQuery}
                    results={effectiveWeb.results.slice(0, 6).map((r) => ({
                      name: r.name,
                      snippet: r.snippet,
                      host_name: r.host_name,
                    }))}
                    onSearch={runSearch}
                  />
                )}

                <WebResults
                  results={effectiveWeb?.results || []}
                  query={activeQuery}
                  loading={webBusy}
                  error={webError}
                  onRetry={retryWeb}
                />

                {effectiveWeb && effectiveWeb.results.length > 0 && (effectiveWeb.hasMore || page > 1) && (
                  <Pagination
                    page={page}
                    hasMore={effectiveWeb.hasMore}
                    onSelect={selectPage}
                  />
                )}
              </div>
            ) : (
              <div className="mx-auto w-full max-w-6xl px-4 py-5">
                <p className="mb-5 text-xs text-muted-foreground" aria-live="polite">
                  {imageBusy
                    ? "Görseller getiriliyor..."
                    : `${effectiveImages.length} görsel bulundu`}
                </p>
                <ImageResults
                  results={effectiveImages}
                  loading={imageBusy}
                  error={imageError}
                  onRetry={retryImages}
                  query={activeQuery}
                />
              </div>
            )}
          </main>
        </>
      ) : (
        <>
          {/* ---------- Home ---------- */}
          <div className="flex items-center justify-end px-4 pt-4">
            <ThemeToggle mounted={mounted} />
          </div>

          <main className="flex flex-1 flex-col items-center justify-center px-4 pb-24">
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
            >
              <Logo className="h-[72px] md:h-24 w-auto" />
            </motion.div>

            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.2, duration: 0.5 }}
              className="mt-4 text-sm text-muted-foreground"
            >
              Gerçek zamanlı web arama — web, görseller ve AI özeti
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1, duration: 0.5 }}
              className="mt-8 w-full max-w-xl"
            >
              <SearchBar
                value={inputValue}
                onValueChange={setInputValue}
                onSubmit={runSearch}
                size="lg"
                autoFocus
                recents={recents}
                onClearRecents={clearRecents}
                inputRef={inputRef}
              />
            </motion.div>

            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.25, duration: 0.5 }}
              className="mt-8 flex flex-wrap items-center justify-center gap-3"
            >
              <Button
                variant="secondary"
                onClick={() => inputValue.trim() && runSearch(inputValue)}
                className="gap-2"
              >
                <Search className="size-4" aria-hidden="true" />
                Ara
              </Button>
              <Button
                variant="secondary"
                onClick={() => runSearch(TRENDING[Math.floor(Math.random() * TRENDING.length)])}
                className="gap-2"
              >
                <Dices className="size-4" aria-hidden="true" />
                Şansımı Deneyle
              </Button>
            </motion.div>

            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.35, duration: 0.5 }}
              className="mt-12 w-full max-w-xl"
            >
              <p className="mb-3 text-center text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Popüler aramalar
              </p>
              <div className="flex flex-wrap justify-center gap-2">
                {TRENDING.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => runSearch(t)}
                    className="rounded-full border bg-background px-3.5 py-1.5 text-sm text-muted-foreground transition-all hover:border-foreground/30 hover:text-foreground hover:shadow-sm"
                  >
                    {t}
                  </button>
                ))}
              </div>
            </motion.div>
          </main>
        </>
      )}

      {/* ---------- Sticky footer ---------- */}
      <footer className="mt-auto border-t bg-muted/40">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-2 px-4 py-3 text-sm text-muted-foreground sm:flex-row">
          <p className="flex items-center gap-1">
            <Logo className="h-5 w-auto" />
            <span className="ml-1">— gerçek zamanlı web araması</span>
          </p>
          <p>Türkiye&apos;den ❤️ ile geliştirildi</p>
          <p className="hidden md:block">
            İpucu: <kbd className="rounded border bg-background px-1.5 py-0.5 text-xs">/</kbd>{" "}
            tuşu arama kutusuna odaklanır
          </p>
        </div>
      </footer>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  layoutId,
  children,
}: {
  active: boolean;
  onClick: () => void;
  layoutId: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`relative flex items-center gap-2 px-4 py-2.5 text-sm transition-colors ${
        active ? "font-medium text-foreground" : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
      {active && (
        <motion.span
          layoutId={layoutId}
          className="absolute inset-x-2 -bottom-px h-[3px] rounded-full bg-[#4285F4]"
        />
      )}
    </button>
  );
}

function ThemeToggle({ mounted }: { mounted: boolean }) {
  const { resolvedTheme, setTheme } = useTheme();
  if (!mounted) {
    return <span className="size-9" aria-hidden="true" />;
  }
  const isDark = resolvedTheme === "dark";
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      aria-label={isDark ? "Açık temaya geç" : "Koyu temaya geç"}
      className="shrink-0"
    >
      {isDark ? <Sun className="size-5" aria-hidden="true" /> : <Moon className="size-5" aria-hidden="true" />}
    </Button>
  );
}
