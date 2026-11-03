"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { RotateCcw, SearchX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

export interface WebResult {
  url: string;
  name: string;
  snippet: string;
  host_name: string;
  rank: number;
  date: string;
  favicon: string;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function extractTerms(query: string): string[] {
  const seen = new Set<string>();
  const terms = query
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && !seen.has(t.toLowerCase()) && seen.add(t.toLowerCase()));
  return terms.slice(0, 6);
}

function Highlighted({ text, terms }: { text: string; terms: string[] }) {
  if (!terms.length || !text) return <>{text}</>;
  const regex = new RegExp(`(${terms.map(escapeRegExp).join("|")})`, "gi");
  const parts = text.split(regex);
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <b key={i} className="font-semibold text-foreground">
            {part}
          </b>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  );
}

function Favicon({ host }: { host: string }) {
  const [failed, setFailed] = useState(false);
  const safeHost = (host || "").replace(/^www\./, "");
  const letter = (safeHost || "?").charAt(0).toUpperCase();

  if (failed || !safeHost) {
    return (
      <span className="flex size-4 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-muted-foreground">
        {letter}
      </span>
    );
  }
  return (
    <img
      src={`https://icons.duckduckgo.com/ip3/${safeHost}.ico`}
      alt=""
      width={16}
      height={16}
      className="size-4 rounded-full object-contain"
      onError={() => setFailed(true)}
      loading="lazy"
    />
  );
}

function formatDate(dateStr: string): string {
  if (!dateStr) return "";
  const parsed = new Date(dateStr);
  if (isNaN(parsed.getTime()) || parsed.getFullYear() < 1990) return "";
  return parsed.toLocaleDateString("tr-TR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/** The upstream snippets sometimes embed a leading date — strip it to avoid duplication. */
function cleanSnippet(snippet: string): string {
  return snippet.replace(/^[A-Za-z]{3} \d{1,2}, \d{4}\s*[—-]\s*/, "").trim();
}

function pathOf(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname === "/" ? "" : u.pathname.replace(/\/$/, "");
  } catch {
    return "";
  }
}

/** Hostname derived from the actual result URL — the ground truth for display. */
function hostOfUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function ResultItem({ result, terms, index }: { result: WebResult; terms: string[]; index: number }) {
  const date = formatDate(result.date);
  const path = pathOf(result.url);
  // Derive the displayed host from the real URL (never trust host_name alone,
  // otherwise redirect-URL results render as "https://SourceName/...").
  const displayHost = hostOfUrl(result.url) || result.host_name.replace(/^www\./, "");

  return (
    <motion.article
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay: Math.min(index * 0.05, 0.4) }}
      className="group"
    >
      <div className="flex items-center gap-2.5">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full border bg-background">
          <Favicon host={displayHost} />
        </span>
        <div className="min-w-0 leading-tight">
          <p className="truncate text-sm">{displayHost}</p>
          <p className="truncate text-xs text-muted-foreground">
            https://{displayHost}
            {path}
          </p>
        </div>
      </div>
      <a
        href={result.url}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-1.5 inline-block text-lg leading-snug text-[#1a0dab] hover:underline md:text-xl dark:text-[#8ab4f8] dark:visited:text-[#c58af9]"
      >
        {result.name}
      </a>
      <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
        {date && <span className="mr-1.5 text-xs">{date} — </span>}
        <Highlighted text={cleanSnippet(result.snippet)} terms={terms} />
      </p>
    </motion.article>
  );
}

function SkeletonList() {
  return (
    <div className="space-y-8" aria-hidden="true">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="space-y-2.5">
          <div className="flex items-center gap-2.5">
            <Skeleton className="size-7 rounded-full" />
            <div className="space-y-1.5">
              <Skeleton className="h-3.5 w-32" />
              <Skeleton className="h-3 w-48" />
            </div>
          </div>
          <Skeleton className="h-5 w-3/4" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
        </div>
      ))}
    </div>
  );
}

export function NoResults({ query }: { query: string }) {
  return (
    <div className="flex flex-col items-center gap-4 rounded-2xl border bg-card px-6 py-12 text-center">
      <span className="flex size-14 items-center justify-center rounded-full bg-muted">
        <SearchX className="size-7 text-muted-foreground" aria-hidden="true" />
      </span>
      <div className="space-y-1.5">
        <p className="text-lg font-medium">Aramanızla eşleşen sonuç bulunamadı</p>
        <p className="text-sm text-muted-foreground">
          &quot;{query}&quot; için hiç sonuç dönmedi. Şunları deneyin:
        </p>
      </div>
      <ul className="space-y-1 text-sm text-muted-foreground">
        <li>• Farklı anahtar kelimeler kullanın</li>
        <li>• Daha genel ifadeler yazın</li>
        <li>• Yazım hatalarını kontrol edin</li>
      </ul>
    </div>
  );
}

export function ErrorCard({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center gap-4 rounded-2xl border bg-card px-6 py-12 text-center">
      <p className="text-lg font-medium">Bir sorun oluştu</p>
      <p className="max-w-sm text-sm text-muted-foreground">{message}</p>
      <Button variant="outline" onClick={onRetry} className="gap-2">
        <RotateCcw className="size-4" aria-hidden="true" />
        Tekrar dene
      </Button>
    </div>
  );
}

interface WebResultsProps {
  results: WebResult[];
  query: string;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}

export function WebResults({ results, query, loading, error, onRetry }: WebResultsProps) {
  if (loading && results.length === 0) return <SkeletonList />;
  if (error) return <ErrorCard message={error} onRetry={onRetry} />;
  if (results.length === 0) return <NoResults query={query} />;

  const terms = extractTerms(query);

  return (
    <div className="space-y-7">
      {results.map((r, i) => (
        <ResultItem key={`${r.url}-${i}`} result={r} terms={terms} index={i} />
      ))}
    </div>
  );
}
