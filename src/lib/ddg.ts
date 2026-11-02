import * as cheerio from "cheerio";

/**
 * DuckDuckGo integration — keyless, works in ANY environment
 * (local dev, Vercel, Docker...). Used as the automatic fallback
 * when z-ai-web-dev-sdk is unavailable (e.g. outside the Z.ai sandbox).
 */

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

const TIMEOUT_MS = 8000;

export interface DdgWebResult {
  url: string;
  name: string;
  snippet: string;
  host_name: string;
  rank: number;
  date: string;
  favicon: string;
}

export interface DdgImageResult {
  original_url: string;
  caption?: string;
  source?: string;
  original_width?: string;
  original_height?: string;
}

async function fetchText(url: string, init?: RequestInit): Promise<string> {
  const res = await fetch(url, {
    ...init,
    headers: {
      "User-Agent": UA,
      "Accept-Language": "tr-TR,tr;q=0.9,en;q=0.8",
      ...(init?.headers || {}),
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`DuckDuckGo ${res.status} döndü: ${url.split("?")[0]}`);
  }
  return res.text();
}

/** Decode DDG redirect links: //duckduckgo.com/l/?uddg=<encoded>&rut=... */
function resolveDdgLink(href: string): string {
  try {
    const abs = href.startsWith("//") ? `https:${href}` : href;
    const u = new URL(abs, "https://duckduckgo.com");
    const uddg = u.searchParams.get("uddg");
    if (uddg) return decodeURIComponent(uddg);
    return abs;
  } catch {
    return href;
  }
}

function stripTags(html: string): string {
  return cheerio
    .load(`<div>${html}</div>`)("div")
    .text()
    .replace(/\s+/g, " ")
    .trim();
}

function faviconFor(host: string): string {
  return `https://icons.duckduckgo.com/ip3/${host}.ico`;
}

/** Map recency days to DuckDuckGo's df parameter. */
function dfFromDays(days?: number): string | null {
  if (!days) return null;
  if (days <= 1) return "d";
  if (days <= 7) return "w";
  if (days <= 31) return "m";
  return "y";
}

/**
 * Real web search via html.duckduckgo.com HTML endpoint.
 * Fetches 3 result pages in parallel (~30 results each) for deep pagination.
 */
export async function ddgWebSearch(query: string, recencyDays?: number): Promise<DdgWebResult[]> {
  const df = dfFromDays(recencyDays);
  const pages = [0, 25, 50];

  const htmls = await Promise.all(
    pages.map(async (s) => {
      const params = new URLSearchParams({ q: query, s: String(s), kl: "wt-wt" });
      if (df) params.set("df", df);
      try {
        return await fetchText(`https://html.duckduckgo.com/html/?${params.toString()}`);
      } catch {
        return ""; // one page failing should not kill the whole search
      }
    })
  );

  const seen = new Set<string>();
  const results: DdgWebResult[] = [];

  for (const html of htmls) {
    if (!html) continue;
    const $ = cheerio.load(html);

    $(".result").each((_, el) => {
      const $el = $(el);
      const linkEl = $el.find("a.result__a").first();
      const href = linkEl.attr("href") || "";
      const title = linkEl.text().replace(/\s+/g, " ").trim();
      const url = resolveDdgLink(href);
      if (!url.startsWith("http") || !title) return;

      let host = "";
      try {
        host = new URL(url).hostname.replace(/^www\./, "");
      } catch {
        return;
      }
      if (seen.has(url)) return;
      seen.add(url);

      const snippet = stripTags($el.find(".result__snippet").first().html() || "");
      const dateMatch = $el.find(".result__extras").text().match(/\d{1,2} \w{3} \d{4}/);

      results.push({
        url,
        name: title,
        snippet,
        host_name: host,
        rank: results.length + 1,
        date: dateMatch ? dateMatch[0] : "",
        favicon: faviconFor(host),
      });
    });
  }

  return results;
}

/**
 * Fallback #2: lite.duckduckgo.com — simpler, table-based HTML.
 */
export async function ddgLiteWebSearch(
  query: string,
  recencyDays?: number
): Promise<DdgWebResult[]> {
  const df = dfFromDays(recencyDays);
  const params = new URLSearchParams({ q: query });
  if (df) params.set("df", df);

  const html = await fetchText(`https://lite.duckduckgo.com/lite/?${params.toString()}`);
  const $ = cheerio.load(html);

  const seen = new Set<string>();
  const results: DdgWebResult[] = [];

  $("a.result-link").each((_, el) => {
    const $el = $(el);
    const url = resolveDdgLink($el.attr("href") || "");
    const title = $el.text().replace(/\s+/g, " ").trim();
    if (!url.startsWith("http") || !title || seen.has(url)) return;
    seen.add(url);

    let host = "";
    try {
      host = new URL(url).hostname.replace(/^www\./, "");
    } catch {
      return;
    }

    // Snippet lives in the following <tr> as td.result-snippet
    const rowTr = $el.closest("tr");
    const snippetRow = rowTr.next("tr");
    const snippet = snippetRow.find("td.result-snippet").text().replace(/\s+/g, " ").trim();

    results.push({
      url,
      name: title,
      snippet,
      host_name: host,
      rank: results.length + 1,
      date: "",
      favicon: faviconFor(host),
    });
  });

  return results;
}

/**
 * Fallback #3: Mojeek — independent, bot-friendly search engine.
 * No time filtering support; results are returned unfiltered.
 */
export async function mojeekWebSearch(query: string): Promise<DdgWebResult[]> {
  const html = await fetchText(
    `https://www.mojeek.com/search?q=${encodeURIComponent(query)}`
  );
  const $ = cheerio.load(html);

  const seen = new Set<string>();
  const results: DdgWebResult[] = [];

  $("ul.results-standard li").each((_, el) => {
    const $el = $(el);
    const linkEl = $el.find("a.title").first();
    const url = (linkEl.attr("href") || "").trim();
    const title = linkEl.text().replace(/\s+/g, " ").trim();
    if (!url.startsWith("http") || !title || seen.has(url)) return;
    seen.add(url);

    let host = "";
    try {
      host = new URL(url).hostname.replace(/^www\./, "");
    } catch {
      return;
    }

    const snippet = $el.find("p.s").text().replace(/\s+/g, " ").trim();

    results.push({
      url,
      name: title,
      snippet,
      host_name: host,
      rank: results.length + 1,
      date: "",
      favicon: faviconFor(host),
    });
  });

  return results;
}

/**
 * Provider-agnostic web search: DuckDuckGo HTML → DuckDuckGo Lite → Mojeek.
 * Throws only when every provider fails.
 */
export async function webSearchAny(
  query: string,
  recencyDays?: number
): Promise<{ results: DdgWebResult[]; provider: string }> {
  const providers: Array<{
    name: string;
    fn: () => Promise<DdgWebResult[]>;
  }> = [
    { name: "ddg", fn: () => ddgWebSearch(query, recencyDays) },
    { name: "ddg-lite", fn: () => ddgLiteWebSearch(query, recencyDays) },
    { name: "mojeek", fn: () => mojeekWebSearch(query) },
  ];

  const errors: string[] = [];
  for (const p of providers) {
    try {
      const results = await p.fn();
      if (results.length > 0) {
        return { results, provider: p.name };
      }
      errors.push(`${p.name}: boş döndü`);
    } catch (err) {
      errors.push(`${p.name}: ${(err as Error).message}`);
    }
  }
  throw new Error(`Tüm arama sağlayıcıları başarısız (${errors.join(" | ")})`);
}

/** Extract the vqd token needed by DuckDuckGo's image API. */
async function getVqd(query: string): Promise<string> {
  const html = await fetchText(
    `https://duckduckgo.com/?q=${encodeURIComponent(query)}&iax=images&ia=images`
  );
  const match = html.match(/vqd=["']?([\d-]+)["']?/);
  if (!match) throw new Error("vqd token bulunamadı");
  return match[1];
}

/** Real image search via DuckDuckGo's i.js JSON endpoint. */
export async function ddgImageSearch(query: string): Promise<DdgImageResult[]> {
  const vqd = await getVqd(query);
  const params = new URLSearchParams({
    l: "tr-tr",
    o: "json",
    q: query,
    vqd,
    f: ",,,",
    p: "1",
  });
  const json = await fetchText(`https://duckduckgo.com/i.js?${params.toString()}`);
  const data = JSON.parse(json) as {
    results?: Array<{
      image?: string;
      thumbnail?: string;
      title?: string;
      url?: string;
      width?: number;
      height?: number;
    }>;
  };

  return (data.results || [])
    .filter((r) => r.image && r.image.startsWith("http"))
    .slice(0, 60)
    .map((r) => {
      let source = "";
      try {
        source = r.url ? new URL(r.url).hostname.replace(/^www\./, "") : "";
      } catch {
        source = "";
      }
      return {
        original_url: r.image as string,
        caption: r.title || "",
        source,
        original_width: r.width ? String(r.width) : "",
        original_height: r.height ? String(r.height) : "",
      };
    });
}

/** Autocomplete suggestions via DuckDuckGo's /ac/ endpoint. */
export async function ddgSuggest(query: string): Promise<string[]> {
  const params = new URLSearchParams({ q: query, type: "list" });
  const json = await fetchText(`https://duckduckgo.com/ac/?${params.toString()}`);
  const data = JSON.parse(json) as [string, string[]] | { 1?: string[] } | unknown;

  if (Array.isArray(data) && Array.isArray(data[1])) {
    return data[1].slice(0, 8);
  }
  return [];
}
