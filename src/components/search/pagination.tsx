"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";

interface PaginationProps {
  page: number;
  hasMore: boolean;
  onSelect: (page: number) => void;
}

/**
 * Google-style numbered pagination. The upstream API does not expose a total
 * page count, so we render a window of known/likely pages around the current one.
 */
export function Pagination({ page, hasMore, onSelect }: PaginationProps) {
  const lastKnown = hasMore ? page + 2 : page;
  const start = Math.max(1, Math.min(page - 2, lastKnown - 4));

  const pages: number[] = [];
  for (let p = start; p <= Math.min(lastKnown, start + 4); p++) {
    pages.push(p);
  }

  return (
    <nav aria-label="Sayfalama" className="flex items-center justify-center gap-1.5 py-10">
      <Button
        variant="ghost"
        size="sm"
        disabled={page <= 1}
        onClick={() => onSelect(page - 1)}
        className="gap-1"
      >
        <ChevronLeft className="size-4" aria-hidden="true" />
        Önceki
      </Button>

      {start > 1 && <span className="px-1 text-muted-foreground">…</span>}

      {pages.map((p) =>
        p === page ? (
          <span
            key={p}
            aria-current="page"
            className="flex size-9 items-center justify-center rounded-md bg-muted text-sm font-medium"
          >
            {p}
          </span>
        ) : (
          <button
            key={p}
            type="button"
            onClick={() => onSelect(p)}
            aria-label={`${p}. sayfaya git`}
            className="flex size-9 items-center justify-center rounded-md text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            {p}
          </button>
        )
      )}

      {hasMore && <span className="px-1 text-muted-foreground">…</span>}

      <Button
        variant="ghost"
        size="sm"
        disabled={!hasMore}
        onClick={() => onSelect(page + 1)}
        className="gap-1"
      >
        Sonraki
        <ChevronRight className="size-4" aria-hidden="true" />
      </Button>
    </nav>
  );
}
