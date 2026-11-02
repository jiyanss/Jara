import { NextRequest, NextResponse } from "next/server";
import { getZAI } from "@/lib/zai";
import { globalCache } from "@/lib/cache";

export const dynamic = "force-dynamic";

interface WebResult {
  url: string;
  name: string;
  snippet: string;
  host_name: string;
  rank: number;
  date: string;
  favicon: string;
}

interface SearchCacheEntry {
  results: WebResult[];
  fetchedAt: number;
  tookMs: number;
}

const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const PER_PAGE = 10;
const MAX_PAGES = 10;

const TIME_FILTERS: Record<string, number | undefined> = {
  all: undefined,
  day: 1,
  week: 7,
  month: 30,
  year: 365,
};

/**
 * GET /api/search?q=...&page=1&time=all|day|week|month|year
 * Real web search powered by z-ai-web-dev-sdk `web_search`.
 * Results are cached server-side per (query, timeFilter) so pagination
 * does not re-trigger the upstream search.
 */
export async function GET(request: NextRequest) {
  try {
    const q = (request.nextUrl.searchParams.get("q") || "").trim();
    const page = Math.max(
      1,
      Math.min(MAX_PAGES, parseInt(request.nextUrl.searchParams.get("page") || "1", 10) || 1)
    );
    const time = request.nextUrl.searchParams.get("time") || "all";
    const recencyDays = TIME_FILTERS[time] ?? TIME_FILTERS.all;

    if (!q) {
      return NextResponse.json({ error: "Arama sorgusu gerekli." }, { status: 400 });
    }

    const cache = globalCache<SearchCacheEntry>("__araSearchCache", CACHE_TTL_MS, 150);
    const cacheKey = `${q.toLowerCase()}::${time}`;
    let entry = cache.get(cacheKey);

    if (!entry) {
      const zai = await getZAI();
      const startedAt = Date.now();
      let results: WebResult[] = [];

      // The upstream API may cap `num`; try progressively smaller sizes.
      for (const num of [30, 20, 10]) {
        try {
          const args: { query: string; num: number; recency_days?: number } = {
            query: q,
            num,
          };
          if (recencyDays) args.recency_days = recencyDays;
          const res = await zai.functions.invoke("web_search", args);
          results = (res || []) as WebResult[];
          if (results.length > 0) break;
        } catch (err) {
          console.error(`[api/search] web_search failed with num=${num}:`, err);
        }
      }

      if (results.length === 0) {
        return NextResponse.json(
          { error: "Arama sonuçları şu anda alınamadı. Lütfen kısa süre sonra tekrar deneyin." },
          { status: 502 }
        );
      }

      entry = { results, fetchedAt: Date.now(), tookMs: Date.now() - startedAt };
      cache.set(cacheKey, entry);
    }

    const total = entry.results.length;
    const startIdx = (page - 1) * PER_PAGE;
    const items = entry.results.slice(startIdx, startIdx + PER_PAGE);

    return NextResponse.json({
      q,
      page,
      time,
      perPage: PER_PAGE,
      total,
      hasMore: startIdx + PER_PAGE < total,
      tookMs: entry.tookMs,
      cached: true,
      results: items,
    });
  } catch (error) {
    console.error("[api/search] unexpected error:", error);
    return NextResponse.json(
      { error: "Sunucu hatası oluştu. Lütfen tekrar deneyin." },
      { status: 500 }
    );
  }
}
