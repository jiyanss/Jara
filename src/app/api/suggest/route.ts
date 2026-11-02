import { NextRequest, NextResponse } from "next/server";
import { getZAI } from "@/lib/zai";
import { globalCache } from "@/lib/cache";
import { ddgSuggest, qwantSuggest } from "@/lib/ddg";

export const dynamic = "force-dynamic";

const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

/**
 * GET /api/suggest?q=...
 * LLM-powered autocomplete suggestions (like Google Suggest).
 * Returns { suggestions: string[] } — always succeeds with an empty list
 * on failure so the UI can degrade gracefully.
 */
export async function GET(request: NextRequest) {
  const q = (request.nextUrl.searchParams.get("q") || "").trim();

  if (q.length < 2 || q.length > 80) {
    return NextResponse.json({ suggestions: [] });
  }

  try {
    const cache = globalCache<string[]>("__araSuggestCache", CACHE_TTL_MS, 300);
    const cached = cache.get(q.toLowerCase());
    if (cached) {
      return NextResponse.json({ suggestions: cached });
    }

    let suggestions: string[] = [];

    // Strategy 1: LLM-powered suggestions (works inside the Z.ai sandbox)
    try {
      const zai = await getZAI();
      const completion = await zai.chat.completions.create({
        messages: [
          {
            role: "assistant",
            content:
              'Sen bir arama motorunun otomatik tamamlama motorusun. Kullanıcının yazmaya başladığı sorguyu tamamlayan 6 kısa arama önerisi üret. Kurallar: Öneriler kullanıcının dilinde ve sorguyla ilgili olsun. Her öneri 2-6 kelime olsun. İlk öneri sorgunun en olası tamamlanması olsun. Yanıtını SADECE şu JSON formatında ver, başka hiçbir metin ekleme: {"suggestions": ["öneri1", "öneri2", "öneri3", "öneri4", "öneri5", "öneri6"]}',
          },
          { role: "user", content: q },
        ],
        thinking: { type: "disabled" },
      });

      const raw = completion?.choices?.[0]?.message?.content || "";
      const cleaned = raw.replace(/```(?:json)?/gi, "").replace(/```/g, "").trim();
      const match = cleaned.match(/\{[\s\S]*\}/);

      if (match) {
        try {
          const parsed = JSON.parse(match[0]);
          if (Array.isArray(parsed.suggestions)) {
            suggestions = parsed.suggestions
              .filter((s: unknown): s is string => typeof s === "string" && s.trim().length > 0)
              .slice(0, 6);
          }
        } catch {
          suggestions = [];
        }
      }
    } catch (err) {
      // ZAI unavailable (e.g. Vercel) — fall back to DuckDuckGo autocomplete
      console.warn("[api/suggest] z-ai-sdk unavailable, falling back:", (err as Error).message);
    }

    // Strategy 2: keyless chains — DuckDuckGo autocomplete, then Qwant
    if (suggestions.length === 0) {
      try {
        suggestions = await ddgSuggest(q);
      } catch (err) {
        console.error("[api/suggest] ddg suggest failed:", err);
      }
    }
    if (suggestions.length === 0) {
      try {
        suggestions = await qwantSuggest(q);
      } catch (err) {
        console.error("[api/suggest] qwant suggest failed:", err);
      }
    }

    if (suggestions.length > 0) {
      cache.set(q.toLowerCase(), suggestions);
    }

    return NextResponse.json({ suggestions });
  } catch (error) {
    console.error("[api/suggest] error:", error);
    // Degrade gracefully — suggestions are optional UX sugar
    return NextResponse.json({ suggestions: [] });
  }
}
