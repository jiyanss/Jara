"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { ExternalLink, RotateCcw, SearchX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorCard, NoResults } from "./web-results";

export interface ImageItem {
  original_url: string;
  caption?: string;
  source?: string;
  original_width?: string;
  original_height?: string;
}

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function ImageSkeletons() {
  return (
    <div className="columns-2 gap-3 sm:columns-3 lg:columns-4" aria-hidden="true">
      {[200, 150, 220, 180, 160, 200, 140, 190].map((h, i) => (
        <Skeleton key={i} className="mb-3 w-full rounded-xl" style={{ height: h }} />
      ))}
    </div>
  );
}

interface ImageResultsProps {
  results: ImageItem[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  query: string;
}

export function ImageResults({ results, loading, error, onRetry, query }: ImageResultsProps) {
  const [selected, setSelected] = useState<ImageItem | null>(null);

  if (loading && results.length === 0) return <ImageSkeletons />;
  if (error) return <ErrorCard message={error} onRetry={onRetry} />;
  if (results.length === 0) return <NoResults query={query} />;

  return (
    <>
      <div className="columns-2 gap-3 sm:columns-3 lg:columns-4">
        {results.map((img, i) => (
          <motion.button
            key={`${img.original_url}-${i}`}
            type="button"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, delay: Math.min(i * 0.03, 0.3) }}
            onClick={() => setSelected(img)}
            className="group relative mb-3 block w-full overflow-hidden rounded-xl border bg-muted text-left focus-visible:outline-2 focus-visible:outline-[#4285F4]"
            aria-label={img.caption || `Görsel: ${img.source || "kaynak"}`}
          >
            <img
              src={img.original_url}
              alt={img.caption || `${query} görsel sonucu`}
              loading="lazy"
              className="w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
            />
            <span className="absolute inset-x-0 bottom-0 line-clamp-1 bg-gradient-to-t from-black/75 to-transparent p-2 text-left text-xs text-white opacity-0 transition-opacity group-hover:opacity-100">
              {img.caption || img.source || domainOf(img.original_url)}
            </span>
          </motion.button>
        ))}
      </div>

      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="max-w-3xl" aria-describedby={undefined}>
          {selected && (
            <DialogHeader className="space-y-4">
              <DialogTitle className="text-left text-base font-medium leading-snug">
                {selected.caption || `${query} — görsel sonucu`}
              </DialogTitle>
              <img
                src={selected.original_url}
                alt={selected.caption || `${query} görsel sonucu`}
                className="max-h-[60vh] w-full rounded-lg bg-muted object-contain"
              />
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="text-sm text-muted-foreground">
                  {selected.source || domainOf(selected.original_url)}
                </span>
                <Button asChild className="gap-2">
                  <a href={selected.original_url} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="size-4" aria-hidden="true" />
                    Görseli aç
                  </a>
                </Button>
              </div>
            </DialogHeader>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
