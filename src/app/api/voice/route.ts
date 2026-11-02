import { NextRequest, NextResponse } from "next/server";
import { getZAI } from "@/lib/zai";

export const dynamic = "force-dynamic";

/**
 * POST /api/voice  { audio: base64String }
 * Speech-to-text for voice search using z-ai-web-dev-sdk ASR.
 * Returns { text: string }.
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { audio?: string };
    const audio = typeof body.audio === "string" ? body.audio : "";
    const base64Audio = audio.replace(/^data:[^;]+;base64,/, "").trim();

    if (!base64Audio) {
      return NextResponse.json({ error: "Ses verisi gerekli." }, { status: 400 });
    }

    // Rough size guard (~20MB of base64)
    if (base64Audio.length > 20 * 1024 * 1024) {
      return NextResponse.json({ error: "Ses kaydı çok büyük." }, { status: 413 });
    }

    let zai;
    try {
      zai = await getZAI();
    } catch (err) {
      // SDK config missing (e.g. deployed outside the Z.ai sandbox)
      console.warn("[api/voice] z-ai-sdk unavailable:", (err as Error).message);
      return NextResponse.json(
        { error: "Sesli arama yalnızca Z.ai destekli ortamlarda kullanılabilir." },
        { status: 503 }
      );
    }
    const res = await zai.audio.asr.create({ file_base64: base64Audio });

    // The SDK returns a loose shape; normalize common variants
    const payload = res as { text?: string; data?: { text?: string }; result?: { text?: string } };
    const text =
      (payload.text || payload.data?.text || payload.result?.text || "").toString().trim();

    if (!text) {
      return NextResponse.json(
        { error: "Ses anlaşılamadı, lütfen tekrar deneyin." },
        { status: 422 }
      );
    }

    return NextResponse.json({ text });
  } catch (error) {
    console.error("[api/voice] error:", error);
    return NextResponse.json(
      { error: "Ses tanıma sırasında hata oluştu." },
      { status: 500 }
    );
  }
}
