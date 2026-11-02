import { NextRequest, NextResponse } from "next/server";
import { getZAI } from "@/lib/zai";
import { globalCache } from "@/lib/cache";

export const dynamic = "force-dynamic";

interface ImageResultItem {
  original_url: string;
  caption?: string;
  source?: string;
  original_width?: string;
  original_height?: string;
}

const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

/**
 * GET /api/images?q=...&count=40
 * Real image search powered by z-ai-web-dev-sdk `images.search`.
 */
export async function GET(request: NextRequest) {
  try {
    const q = (request.nextUrl.searchParams.get("q") || "").trim();
    if (!q) {
      return NextResponse.json({ error: "Arama sorgusu gerekli." }, { status: 400 });
    }

    const cache = globalCache<ImageResultItem[]>("__araImageCache", CACHE_TTL_MS, 100);
    const cacheKey = q.toLowerCase();
    let results = cache.get(cacheKey);

    if (!results) {
      const zai = await getZAI();
      results = [];

      // NOTE: rank:true is dramatically slower (~45s vs ~10s), so we search unranked.
      for (const count of [20, 10]) {
        try {
          const res = await zai.images.search.create({
            query: q,
            count,
            gl: "tr",
            rank: false,
          });
          results = (res?.results || []) as ImageResultItem[];
          if (results.length > 0) break;
        } catch (err) {
          console.error(`[api/images] image search failed with count=${count}:`, err);
        }
      }

      if (results.length === 0) {
        return NextResponse.json(
          { error: "Görsel sonuçları şu anda alınamadı. Lütfen tekrar deneyin." },
          { status: 502 }
        );
      }

      // Filter out entries without a usable URL
      results = results.filter(
        (r) => r && typeof r.original_url === "string" && r.original_url.startsWith("http")
      );
      cache.set(cacheKey, results);
    }

    return NextResponse.json({ q, total: results.length, results });
  } catch (error) {
    console.error("[api/images] unexpected error:", error);
    return NextResponse.json(
      { error: "Sunucu hatası oluştu. Lütfen tekrar deneyin." },
      { status: 500 }
    );
  }
}
