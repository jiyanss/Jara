/**
 * Keyless AI-overview fallbacks — used when z-ai-web-dev-sdk is unavailable
 * (Vercel, any non-Z.ai environment). Both return an honest, sourced summary
 * or null so the caller can hide the card.
 */

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

const WIKI_UA = {
  "User-Agent": "JaraSearch/1.0 (https://jara-xi.vercel.app; search engine project)",
  "Api-User-Agent": "JaraSearch/1.0 (https://jara-xi.vercel.app; search engine project)",
};

/**
 * Wikipedia REST summary for the query. Only accepted when a search hit's
 * TITLE strongly matches the whole query — otherwise the digest would
 * describe a different subject than the one the user searched for.
 */
export async function wikipediaDigest(q: string): Promise<OverviewData | null> {
  const nq = q.toLowerCase().replace(/\s+/g, " ").trim();
  if (!nq) return null;

  for (const lang of ["tr", "en"]) {
    try {
      const params = new URLSearchParams({
        action: "query",
        list: "search",
        srsearch: q,
        srlimit: "6",
        format: "json",
        origin: "*",
      });
      const res = await fetch(`https://${lang}.wikipedia.org/w/api.php?${params.toString()}`, {
        headers: WIKI_UA,
        signal: AbortSignal.timeout(6000),
      });
      if (!res.ok) continue;
      const data = (await res.json()) as {
        query?: { search?: Array<{ title?: string }> };
      };
      const hits = data?.query?.search || [];
      const hit = hits.find((h) => {
        const t = (h.title || "").toLowerCase().replace(/\s+/g, " ").trim();
        return !!t && (t.includes(nq) || (nq.includes(t) && t.length >= 5));
      });
      if (!hit?.title) continue;

      const title = hit.title.replace(/ /g, "_");
      const sumRes = await fetch(
        `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}?redirect=true`,
        { headers: WIKI_UA, signal: AbortSignal.timeout(6000) }
      );
      if (!sumRes.ok) continue;
      const sum = (await sumRes.json()) as {
        extract?: string;
        content_urls?: { desktop?: { page?: string } };
      };
      const extract = (sum?.extract || "").trim();
      if (extract.length < 40) continue;

      const related = hits
        .filter((h) => h.title && h.title !== hit.title)
        .map((h) => h.title as string)
        .slice(0, 4);

      const sourceUrl =
        sum?.content_urls?.desktop?.page ||
        `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(title)}`;

      return {
        summary: extract,
        related,
        mode: "digest",
        source: `${lang}.wikipedia.org`,
        sourceUrl,
      };
    } catch {
      continue; // try next language
    }
  }
  return null;
}

/**
 * No LLM, no external calls: stitch the most on-topic snippets of the actual
 * search results into an honest "derived from results" digest.
 */
export function extractiveDigest(q: string, results: OverviewResultInput[]): OverviewData | null {
  const tokens = Array.from(
    new Set(
      (q.toLowerCase().split(/[^a-z0-9çğıöşü]+/) || [])
        .filter((t) => t.length >= 3)
        .slice(0, 8)
    )
  );

  const scored = results
    .map((r) => {
      const hay = `${r.name || ""} ${r.snippet || ""}`.toLowerCase();
      const score = tokens.length === 0 ? 1 : tokens.filter((t) => hay.includes(t)).length;
      return { r, score };
    })
    .filter((s) => s.score > 0 && (s.r.snippet || "").replace(/\s+/g, " ").trim().length > 40)
    .sort((a, b) => b.score - a.score);

  // Prefer one snippet per host so the digest is not a single-source echo
  const picked: Array<{ r: OverviewResultInput }> = [];
  const hosts = new Set<string>();
  for (const s of scored) {
    const h = (s.r.host_name || "").toLowerCase();
    if (hosts.has(h) && picked.length > 0) continue;
    hosts.add(h);
    picked.push(s);
    if (picked.length >= 3) break;
  }
  if (picked.length === 0) return null;

  const bullets = picked
    .map((s) => {
      const snip = (s.r.snippet || "").replace(/\s+/g, " ").trim().slice(0, 220);
      const host = s.r.host_name ? ` — **${s.r.host_name}**` : "";
      return `- ${snip}${host}`;
    })
    .join("\n");

  return { summary: bullets, related: [], mode: "digest" };
}
