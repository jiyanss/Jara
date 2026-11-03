"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Sparkles, X } from "lucide-react";
import ReactMarkdown from "react-markdown";

interface OverviewResult {
  name: string;
  snippet: string;
  host_name: string;
}

interface OverviewData {
  summary: string;
  related: string[];
}

type OverviewState = "loading" | "done" | "error" | "unavailable";

interface AiOverviewProps {
  query: string;
  results: OverviewResult[];
  onSearch: (q: string) => void;
}

/**
 * Google-style "AI Overview" card: an LLM summary of the real search results,
 * plus related search chips. Loads asynchronously so it never blocks results.
 */
export function AiOverview({ query, results, onSearch }: AiOverviewProps) {
  const [state, setState] = useState<OverviewState>("loading");
  const [data, setData] = useState<OverviewData | null>(null);
  const [hidden, setHidden] = useState(false);

  // Keep a stable ref to the latest results so the effect only depends on `query`
  const resultsRef = useRef(results);
  useEffect(() => {
    resultsRef.current = results;
  }, [results]);

  // NOTE: this component is mounted with `key={query}` by the parent, so state
  // resets naturally when the query changes — no synchronous setState needed here.
  useEffect(() => {
    const controller = new AbortController();
    // Small delay so the organic results render first
    const timer = setTimeout(() => {
      fetch("/api/ai-overview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ q: query, results: resultsRef.current.slice(0, 6) }),
        signal: controller.signal,
      })
        .then(async (res): Promise<OverviewData | null> => {
          // 503 = no AI backend in this environment (e.g. Vercel deployment).
          // Hide the card silently instead of showing a permanent error box.
          if (res.status === 503) return null;
          const json = (await res.json()) as OverviewData & { error?: string };
          if (!res.ok || !json.summary) throw new Error(json.error || "failed");
          return { summary: json.summary, related: json.related || [] };
        })
        .then((json) => {
          if (!json) {
            setState("unavailable");
            return;
          }
          setData(json);
          setState("done");
        })
        .catch((err: unknown) => {
          if ((err as Error).name !== "AbortError") setState("error");
        });
    }, 500);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  if (hidden || state === "unavailable") return null;

  return (
    <motion.section
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      aria-label="AI genel bakış"
      className="mb-8 rounded-2xl border bg-card p-5"
    >
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Sparkles className="size-4 text-[#34A853]" aria-hidden="true" />
          AI Genel Bakış
        </h2>
        <button
          type="button"
          onClick={() => setHidden(true)}
          aria-label="AI özetini kapat"
          className="rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      </div>

      {state === "loading" && (
        <div className="space-y-2.5" aria-hidden="true">
          <div className="shimmer h-4 w-full rounded" />
          <div className="shimmer h-4 w-11/12 rounded" />
          <div className="shimmer h-4 w-3/4 rounded" />
        </div>
      )}

      {state === "error" && (
        <p className="text-sm text-muted-foreground">
          Özet şu anda oluşturulamadı, ancak aşağıdaki arama sonuçlarını kullanabilirsiniz.
        </p>
      )}

      {state === "done" && data && (
        <>
          <div className="text-sm leading-relaxed text-foreground/90">
            <ReactMarkdown
              components={{
                p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
                strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
                ul: ({ children }) => <ul className="mb-2 list-disc space-y-1 pl-5">{children}</ul>,
                li: ({ children }) => <li>{children}</li>,
              }}
            >
              {data.summary}
            </ReactMarkdown>
          </div>

          {data.related.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {data.related.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => onSearch(r)}
                  className="rounded-full border bg-background px-3.5 py-1.5 text-sm text-muted-foreground transition-all hover:border-foreground/30 hover:text-foreground hover:shadow-sm"
                >
                  {r}
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </motion.section>
  );
}
