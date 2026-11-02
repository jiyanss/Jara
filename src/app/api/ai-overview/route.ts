import { NextRequest, NextResponse } from "next/server";
import { getZAI } from "@/lib/zai";
import { globalCache } from "@/lib/cache";

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
    return { summary, related: related.slice(0, 4) };
  } catch {
    return null;
  }
}

/**
 * POST /api/ai-overview  { q: string, results: [{name, snippet, host_name}] }
 * Generates a Google-style "AI Overview" summary in Turkish (or the query's
 * language) based on the real web search results, plus related searches.
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

    const zai = await getZAI();
    const completion = await zai.chat.completions.create({
      messages: [
        {
          role: "assistant",
          content:
            'Sen "Ara!" arama motorunun AI özet asistanısın. Sana kullanıcının arama sorgusu ve o sorguya ait gerçek web arama sonuçları verilecek. Görevin: (1) Sonuçlara dayanarak sorguya doğrudan yanıt veren 2-4 cümlelik bir özet yaz. Özet, sorgunun dilinde olsun (sorgu Türkçe ise Türkçe yaz). Yalnızca sonuçlarda geçen bilgileri kullan, asla uydurma. Uygun gördüğün yerlerde **kalın** vurgu kullanabilirsin. (2) Sorguyla ilgili 4 kısa takip arama önerisi üret. Yanıtını SADECE şu JSON formatında ver, başka hiçbir metin ekleme: {"summary": "...", "related": ["öneri1", "öneri2", "öneri3", "öneri4"]}',
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

    if (!data) {
      // Fall back to the raw text as the summary if JSON parsing fails
      const fallback = raw.replace(/```(?:json)?/gi, "").replace(/```/g, "").trim();
      if (fallback.length > 20) {
        const result: OverviewData = { summary: fallback, related: [] };
        cache.set(q.toLowerCase(), result);
        return NextResponse.json(result);
      }
      return NextResponse.json(
        { error: "AI özeti şu anda oluşturulamadı." },
        { status: 502 }
      );
    }

    cache.set(q.toLowerCase(), data);
    return NextResponse.json(data);
  } catch (error) {
    console.error("[api/ai-overview] error:", error);
    return NextResponse.json(
      { error: "AI özeti oluşturulurken hata oluştu." },
      { status: 500 }
    );
  }
}
