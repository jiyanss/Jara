import { NextRequest, NextResponse } from "next/server";
import { getZAI } from "@/lib/zai";
import { globalCache } from "@/lib/cache";
import { wikipediaDigest, extractiveDigest } from "@/lib/overview-fallback";

export const dynamic = "force-dynamic";

interface OverviewResultInput {
  name?: string;
  snippet?: string;
  host_name?: string;
  url?: string;
}

interface OverviewData {
  summary: string;
  related: string[];
  /** "ai" = LLM overview, "digest" = keyless fallback (wiki/extractive). */
  mode?: "ai" | "digest";
  source?: string;
  sourceUrl?: string;
}

const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

function extractJson(raw: string): OverviewData | null {
  const cleaned = raw
    .replace(/```(?:json)?/gi, "")
    .replace(/```/g, "")
    .trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]);
    const summary = typeof parsed.summary === "string" ? parsed.summary.trim() : "";
    const related = Array.isArray(parsed.related)
      ? parsed.related.filter((s: unknown): s is string => typeof s === "string" && s.trim().length > 0)
      : [];
    if (!summary) return null;
    return { summary, related: related.slice(0, 4), mode: "ai" };
  } catch {
    return null;
  }
}

/**
 * POST /api/ai-overview  { q: string, results: [{name, snippet, host_name}] }
 *
 * Generates a Google-style overview in the query's language:
 *   1. LLM summary via z-ai-web-dev-sdk (Z.ai sandbox)            → mode "ai"
 *   2. Wikipedia digest (strong title match required)             → mode "digest"
 *   3. Extractive digest built from the real search results       → mode "digest"
 *   4. Nothing worked                                             → 503 (card hidden)
 *
 * Steps 2-3 are keyless, so the overview ALSO works on Vercel and any other
 * environment where the Z.ai SDK is unavailable.
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { q?: string; results?: OverviewResultInput[] };
    const q = (body.q || "").trim();
    const results = Array.isArray(body.results) ? body.results.slice(0, 6) : [];

    if (!q) {
      return NextResponse.json({ error: "Arama sorgusu gerekli." }, { status: 400 });
    }

    const cache = globalCache<OverviewData>("__araOverviewCache", CACHE_TTL_MS, 100);
    const cached = cache.get(q.toLowerCase());
    if (cached) {
      return NextResponse.json(cached);
    }

    const context = results
      .map(
        (r, i) =>
          `[${i + 1}] ${r.name || ""} — ${r.host_name || ""}\n${(r.snippet || "").slice(0, 400)}`
      )
      .join("\n\n");

    // ---- Path 1: LLM overview (only where the Z.ai SDK is configured) ----
    let zai: Awaited<ReturnType<typeof getZAI>> | null = null;
    try {
      zai = await getZAI();
    } catch (err) {
      // SDK unavailable (e.g. deployed on Vercel) — expected, fall through
      console.warn("[api/ai-overview] z-ai-sdk unavailable:", (err as Error).message);
    }

    if (zai) {
      try {
        const completion = await zai.chat.completions.create({
          messages: [
            {
              role: "assistant",
              content:
                'Sen "Jara!" arama motorunun AI özet asistanısın. Sana kullanıcının arama sorgusu ve o sorguya ait gerçek web arama sonuçları verilecek. Görevin: (1) Sonuçlara dayanarak sorguya doğrudan yanıt veren 2-4 cümlelik bir özet yaz. Özet, sorgunun dilinde olsun (sorgu Türkçe ise Türkçe yaz). Yalnızca sonuçlarda geçen bilgileri kullan, asla uydurma. Uygun gördüğün yerlerde **kalın** vurgu kullanabilirsin. (2) Sorguyla ilgili 4 kısa takip arama önerisi üret. Yanıtını SADECE şu JSON formatında ver, başka hiçbir metin ekleme: {"summary": "...", "related": ["öneri1", "öneri2", "öneri3", "öneri4"]}',
            },
            {
              role: "user",
              content: `Arama sorgusu: ${q}\n\nWeb arama sonuçları:\n${context || "(sonuç yok)"}`,
            },
          ],
          thinking: { type: "disabled" },
        });

        const raw = completion?.choices?.[0]?.message?.content || "";
        const data = extractJson(raw);
        if (data) {
          cache.set(q.toLowerCase(), data);
          return NextResponse.json(data);
        }
        const fallbackText = raw.replace(/```(?:json)?/gi, "").replace(/```/g, "").trim();
        if (fallbackText.length > 20) {
          const result: OverviewData = { summary: fallbackText, related: [], mode: "ai" };
          cache.set(q.toLowerCase(), result);
          return NextResponse.json(result);
        }
      } catch (err) {
        console.warn("[api/ai-overview] LLM call failed, trying keyless digest:", (err as Error).message);
      }
    }

    // ---- Path 2/3: keyless digests (work everywhere, Vercel included) ----
    const digest = (await wikipediaDigest(q)) ?? extractiveDigest(q, results);
    if (digest) {
      cache.set(q.toLowerCase(), digest);
      return NextResponse.json(digest);
    }

    return NextResponse.json(
      { error: "Özet bu ortamda oluşturulamadı.", unavailable: true },
      { status: 503 }
    );
  } catch (error) {
    console.error("[api/ai-overview] error:", error);
    return NextResponse.json(
      { error: "Özet oluşturulurken hata oluştu." },
      { status: 500 }
    );
  }
}
