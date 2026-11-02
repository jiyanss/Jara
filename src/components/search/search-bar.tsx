"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from "react";
import { Clock, Loader2, Search, X } from "lucide-react";
import { VoiceSearch } from "./voice-search";

interface SearchBarProps {
  value: string;
  onValueChange: (value: string) => void;
  onSubmit: (query: string) => void;
  size?: "md" | "lg";
  autoFocus?: boolean;
  recents?: string[];
  onClearRecents?: () => void;
  inputRef?: RefObject<HTMLInputElement | null>;
  className?: string;
}

interface SuggestCacheEntry {
  value: string[];
  ts: number;
}

const SUGGEST_DEBOUNCE_MS = 350;
const SUGGEST_TTL_MS = 5 * 60 * 1000;

/**
 * Google-style pill search bar with:
 * - LLM-powered autocomplete suggestions (/api/suggest, debounced + cached)
 * - Recent searches from localStorage when the input is empty
 * - Full keyboard navigation (↑ ↓ Enter Escape)
 * - Voice search via microphone
 */
export function SearchBar({
  value,
  onValueChange,
  onSubmit,
  size = "md",
  autoFocus = false,
  recents = [],
  onClearRecents,
  inputRef,
  className = "",
}: SearchBarProps) {
  const internalRef = useRef<HTMLInputElement>(null);
  const ref = inputRef ?? internalRef;
  const wrapRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const cacheRef = useRef<Map<string, SuggestCacheEntry>>(new Map());

  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [suggestLoading, setSuggestLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);

  const trimmed = value.trim();
  const items = trimmed ? suggestions : recents;
  const showDropdown = open && items.length > 0;

  useEffect(() => {
    if (!autoFocus) return;
    const t = setTimeout(() => ref.current?.focus(), 150);
    return () => clearTimeout(t);
  }, [autoFocus, ref]);

  // Debounced suggestion fetching
  useEffect(() => {
    const q = value.trim();
    if (!open || q.length < 2) {
      setSuggestions([]);
      setSuggestLoading(false);
      return;
    }
    const key = q.toLowerCase();
    const cached = cacheRef.current.get(key);
    if (cached && Date.now() - cached.ts < SUGGEST_TTL_MS) {
      setSuggestions(cached.value);
      setSuggestLoading(false);
      return;
    }
    setSuggestLoading(true);
    const timer = setTimeout(async () => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const res = await fetch(`/api/suggest?q=${encodeURIComponent(q)}`, {
          signal: controller.signal,
        });
        const data = (await res.json()) as { suggestions?: string[] };
        const list = Array.isArray(data.suggestions) ? data.suggestions : [];
        cacheRef.current.set(key, { value: list, ts: Date.now() });
        setSuggestions(list);
      } catch (err) {
        if ((err as Error).name !== "AbortError") setSuggestions([]);
      } finally {
        if (abortRef.current === controller) setSuggestLoading(false);
      }
    }, SUGGEST_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [value, open]);

  // Close dropdown on outside click
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const submitQuery = useCallback(
    (q: string) => {
      const query = q.trim();
      if (!query) return;
      setOpen(false);
      setHighlight(-1);
      ref.current?.blur();
      onSubmit(query);
    },
    [onSubmit, ref]
  );

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setHighlight((h) => Math.min(h + 1, items.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, -1));
    } else if (e.key === "Enter") {
      if (highlight >= 0 && items[highlight]) {
        e.preventDefault();
        submitQuery(items[highlight]);
      } else if (trimmed) {
        e.preventDefault();
        submitQuery(value);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
      setHighlight(-1);
    }
  };

  const barHeight = size === "lg" ? "h-12 md:h-14" : "h-11";

  return (
    <div ref={wrapRef} className={`relative ${className}`}>
      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          submitQuery(value);
        }}
        className={`group flex items-center gap-2.5 rounded-full border border-input bg-background px-4 md:gap-3 md:px-5 ${barHeight} transition-all hover:shadow-md focus-within:shadow-md`}
      >
        <Search
          className="size-4 shrink-0 text-muted-foreground transition-colors group-focus-within:text-foreground md:size-5"
          aria-hidden="true"
        />
        <input
          ref={ref}
          type="text"
          value={value}
          onChange={(e) => {
            onValueChange(e.target.value);
            setOpen(true);
            setHighlight(-1);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder="Web'de ara..."
          aria-label="Arama sorgusu"
          autoComplete="off"
          className="flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground/70 md:text-lg"
        />
        {suggestLoading && (
          <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" aria-hidden="true" />
        )}
        {value && (
          <button
            type="button"
            onClick={() => {
              onValueChange("");
              ref.current?.focus();
            }}
            aria-label="Arama kutusunu temizle"
            className="rounded-full p-1.5 transition-colors hover:bg-muted"
          >
            <X className="size-4 text-muted-foreground" aria-hidden="true" />
          </button>
        )}
        <span className="h-6 w-px bg-border" aria-hidden="true" />
        <VoiceSearch
          onResult={(text) => {
            onValueChange(text);
            submitQuery(text);
          }}
        />
      </form>

      {showDropdown && (
        <div className="absolute inset-x-0 top-[calc(100%+8px)] z-50 overflow-hidden rounded-2xl border bg-popover py-2 shadow-xl">
          {trimmed ? (
            <ul role="listbox" aria-label="Arama önerileri">
              {items.map((s, i) => (
                <li key={s}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={i === highlight}
                    className={`flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors hover:bg-muted md:text-base ${
                      i === highlight ? "bg-muted" : ""
                    }`}
                    onMouseEnter={() => setHighlight(i)}
                    onClick={() => submitQuery(s)}
                  >
                    <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <span className="truncate">{s}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div>
              <div className="flex items-center justify-between px-4 pb-1 pt-1">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Son aramalar
                </span>
                {onClearRecents && (
                  <button
                    type="button"
                    onClick={onClearRecents}
                    className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                  >
                    Temizle
                  </button>
                )}
              </div>
              <ul role="listbox" aria-label="Son aramalar">
                {items.map((s, i) => (
                  <li key={s}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={i === highlight}
                      className={`flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors hover:bg-muted md:text-base ${
                        i === highlight ? "bg-muted" : ""
                      }`}
                      onMouseEnter={() => setHighlight(i)}
                      onClick={() => submitQuery(s)}
                    >
                      <Clock className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                      <span className="truncate">{s}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
