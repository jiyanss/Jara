import * as cheerio from "cheerio";

/**
 * Multi-provider search layer — keyless, works in ANY environment
 * (local dev, Vercel, Docker...). Used as the automatic fallback
 * when z-ai-web-dev-sdk is unavailable (e.g. outside the Z.ai sandbox).
 *
 * Web search chain (parallel waves, priority-ordered):
 *   Wave 1: Brave (if BRAVE_API_KEY set) → DuckDuckGo HTML → DDG Lite → Qwant → Mojeek
 *   Wave 2: Google News RSS → Wikipedia API (always reachable, bot-friendly)
 */

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

const TIMEOUT_MS = 6500;

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
    throw new Error(`${res.status} döndü: ${url.split("?")[0]}`);
  }
  return res.text();
}

async function fetchJson(url: string, init?: RequestInit): Promise<unknown> {
  const text = await fetchText(url, {
    ...init,
    headers: { Accept: "application/json", ...(init?.headers || {}) },
  });
  return JSON.parse(text);
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

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** Map recency days to a provider-specific filter. */
function dfFromDays(days?: number): string | null {
  if (!days) return null;
  if (days <= 1) return "d";
  if (days <= 7) return "w";
  if (days <= 31) return "m";
  return "y";
}

function toResults(
  raw: Array<Omit<DdgWebResult, "rank" | "favicon"> & { favicon?: string }>
): DdgWebResult[] {
  const seen = new Set<string>();
  const out: DdgWebResult[] = [];
  for (const r of raw) {
    if (!r.url.startsWith("http") || !r.name || seen.has(r.url)) continue;
    const host = r.host_name || hostOf(r.url);
    if (!host) continue;
    seen.add(r.url);
    out.push({
      url: r.url,
      name: r.name,
      snippet: r.snippet,
      host_name: host,
      rank: out.length + 1,
      date: r.date || "",
      favicon: r.favicon || faviconFor(host),
    });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Wave 1 providers                                                    */
/* ------------------------------------------------------------------ */

/** Brave Search API — best quality, needs a free BRAVE_API_KEY env var. */
export async function braveWebSearch(
  query: string,
  recencyDays?: number
): Promise<DdgWebResult[]> {
  const key = process.env.BRAVE_API_KEY || process.env.SEARCH_API_KEY || "";
  if (!key) return []; // no key configured — skip silently

  const params = new URLSearchParams({ q: query, count: "30", country: "tr", search_lang: "tr" });
  if (recencyDays) {
    params.set("freshness", recencyDays <= 1 ? "pd" : recencyDays <= 7 ? "pw" : recencyDays <= 31 ? "pm" : "py");
  }
  const res = (await fetchJson(
    `https://api.search.brave.com/res/v1/web/search?${params.toString()}`,
    { headers: { "X-Subscription-Token": key, Accept: "application/json" } }
  )) as { web?: { results?: Array<{ title?: string; url?: string; description?: string; age?: string; meta_url?: { hostname?: string } }> } };

  const items = res?.web?.results || [];
  return toResults(
    items.map((r) => ({
      url: r.url || "",
      name: r.title || "",
      snippet: stripTags(r.description || ""),
      host_name: r.meta_url?.hostname?.replace(/^www\./, "") || "",
      date: r.age || "",
    }))
  );
}

/** DuckDuckGo HTML endpoint — fetches 3 pages in parallel for deep pagination. */
export async function ddgWebSearch(
  query: string,
  recencyDays?: number
): Promise<DdgWebResult[]> {
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
      const url = resolveDdgLink(linkEl.attr("href") || "");
      const title = linkEl.text().replace(/\s+/g, " ").trim();
      if (!title || seen.has(url)) return;
      seen.add(url);

      const snippet = stripTags($el.find(".result__snippet").first().html() || "");
      const dateMatch = $el.find(".result__extras").text().match(/\d{1,2} \w{3} \d{4}/);
      results.push({
        url,
        name: title,
        snippet,
        host_name: hostOf(url),
        rank: results.length + 1,
        date: dateMatch ? dateMatch[0] : "",
        favicon: "",
      });
    });
  }

  return toResults(results.map(({ favicon: _f, ...rest }) => rest));
}

/** DuckDuckGo Lite — simpler, table-based HTML. */
export async function ddgLiteWebSearch(
  query: string,
  recencyDays?: number
): Promise<DdgWebResult[]> {
  const df = dfFromDays(recencyDays);
  const params = new URLSearchParams({ q: query });
  if (df) params.set("df", df);

  const html = await fetchText(`https://lite.duckduckgo.com/lite/?${params.toString()}`);
  const $ = cheerio.load(html);

  const raw: Array<Omit<DdgWebResult, "rank" | "favicon">> = [];
  $("a.result-link").each((_, el) => {
    const $el = $(el);
    const url = resolveDdgLink($el.attr("href") || "");
    const title = $el.text().replace(/\s+/g, " ").trim();
    // Snippet lives in the following <tr> as td.result-snippet
    const snippetRow = $el.closest("tr").next("tr");
    const snippet = snippetRow.find("td.result-snippet").text().replace(/\s+/g, " ").trim();
    raw.push({ url, name: title, snippet, host_name: hostOf(url), date: "" });
  });

  return toResults(raw);
}

/** Qwant JSON API (may be bot-guarded on datacenter IPs — kept as a wave-1 candidate). */
export async function qwantWebSearch(
  query: string,
  recencyDays?: number
): Promise<DdgWebResult[]> {
  const params = new URLSearchParams({
    q: query,
    count: "30",
    locale: "tr_tr",
    offset: "0",
    device: "desktop",
    safesearch: "1",
  });
  const res = (await fetchJson(
    `https://api.qwant.com/v3/search/web?${params.toString()}`
  )) as {
    data?: {
      result?: {
        items?: {
          mainline?: Array<{
            type?: string;
            items?: Array<{ title?: string; url?: string; desc?: string; source?: string; date?: string }>;
          }>;
        };
      };
    };
  };

  const raw: Array<Omit<DdgWebResult, "rank" | "favicon">> = [];
  for (const block of res?.data?.result?.items?.mainline || []) {
    for (const item of block?.items || []) {
      raw.push({
        url: item.url || "",
        name: item.title || "",
        snippet: stripTags(item.desc || ""),
        host_name: item.source || "",
        date: item.date || "",
      });
    }
  }
  return toResults(raw);
}

/** Mojeek — independent, bot-friendly search engine (no time filtering). */
export async function mojeekWebSearch(query: string): Promise<DdgWebResult[]> {
  const html = await fetchText(
    `https://www.mojeek.com/search?q=${encodeURIComponent(query)}`
  );
  const $ = cheerio.load(html);

  const raw: Array<Omit<DdgWebResult, "rank" | "favicon">> = [];
  $("ul.results-standard li").each((_, el) => {
    const $el = $(el);
    const linkEl = $el.find("a.title").first();
    const url = (linkEl.attr("href") || "").trim();
    const title = linkEl.text().replace(/\s+/g, " ").trim();
    const snippet = $el.find("p.s").text().replace(/\s+/g, " ").trim();
    raw.push({ url, name: title, snippet, host_name: hostOf(url), date: "" });
  });

  return toResults(raw);
}

/* ------------------------------------------------------------------ */
/* Wave 2 providers — always reachable, bot-friendly                   */
/* ------------------------------------------------------------------ */

/** Decode Google News redirect links (base64-encoded article URLs). */
function decodeGoogleNewsUrl(link: string): string {
  try {
    const u = new URL(link);
    const id = u.pathname.split("/articles/")[1];
    if (!id) return link;
    const bytes = Buffer.from(id.replace(/-/g, "+").replace(/_/g, "/"), "base64");
    const text = bytes.toString("binary");
    const match = text.match(/https?:\/\/[^\x00-\x1f"\\<> ]+/);
    return match ? match[0] : link;
  } catch {
    return link;
  }
}

/** Google News RSS — keyless, extremely reliable (news-focused results). */
export async function googleNewsSearch(
  query: string,
  recencyDays?: number
): Promise<DdgWebResult[]> {
  const when = recencyDays ? (recencyDays <= 1 ? "1d" : recencyDays <= 7 ? "7d" : recencyDays <= 31 ? "1m" : "1y") : "";
  const params = new URLSearchParams({
    q: query,
    hl: "tr",
    gl: "TR",
    ceid: "TR:tr",
  });
  if (when) params.set("when", when);

  const xml = await fetchText(`https://news.google.com/rss/search?${params.toString()}`);
  const $ = cheerio.load(xml, { xmlMode: true });

  const raw: Array<Omit<DdgWebResult, "rank" | "favicon">> = [];
  $("item").each((_, el) => {
    if (raw.length >= 20) return;
    const $el = $(el);
    const titleFull = $el.find("title").first().text().trim();
    const link = $el.find("link").first().text().trim();
    const pubDate = $el.find("pubDate").first().text().trim();
    const source = $el.find("source").first().text().trim();
    const description = stripTags($el.find("description").first().text() || "");

    // "Başlık - Kaynak" → title + source
    const sep = titleFull.lastIndexOf(" - ");
    const name = sep > 0 ? titleFull.slice(0, sep) : titleFull;

    let date = "";
    if (pubDate) {
      const d = new Date(pubDate);
      if (!isNaN(d.getTime())) date = d.toISOString().slice(0, 10);
    }

    raw.push({
      url: decodeGoogleNewsUrl(link),
      name,
      snippet: description || (source ? `${source} kaynağından haber.` : ""),
      host_name: source || hostOf(link),
      date,
    });
  });

  return toResults(raw);
}

/** Wikipedia search API — fully open, great for encyclopedic queries. */
export async function wikipediaSearch(query: string): Promise<DdgWebResult[]> {
  const wikiHeaders = {
    "User-Agent": "JaraSearch/1.0 (https://jara-xi.vercel.app; search engine project)",
    "Api-User-Agent": "JaraSearch/1.0 (https://jara-xi.vercel.app; search engine project)",
  };
  for (const lang of ["tr", "en"]) {
    const params = new URLSearchParams({
      action: "query",
      list: "search",
      srsearch: query,
      srlimit: "8",
      format: "json",
      origin: "*",
    });
    try {
      const res = (await fetchJson(
        `https://${lang}.wikipedia.org/w/api.php?${params.toString()}`,
        { headers: wikiHeaders }
      )) as {
        query?: { search?: Array<{ title?: string; snippet?: string; timestamp?: string }> };
      };
      const hits = res?.query?.search || [];
      if (hits.length === 0) continue;

      return toResults(
        hits.map((h) => ({
          url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent((h.title || "").replace(/ /g, "_"))}`,
          name: h.title || "",
          snippet: stripTags(h.snippet || ""),
          host_name: `${lang}.wikipedia.org`,
          date: h.timestamp ? h.timestamp.slice(0, 10) : "",
        }))
      );
    } catch {
      continue; // try next language
    }
  }
  return [];
}

/* ------------------------------------------------------------------ */
/* Orchestrator                                                        */
/* ------------------------------------------------------------------ */

interface Provider {
  name: string;
  fn: (q: string, days?: number) => Promise<DdgWebResult[]>;
}

const WAVE1: Provider[] = [
  { name: "brave", fn: braveWebSearch },
  { name: "ddg", fn: ddgWebSearch },
  { name: "ddg-lite", fn: ddgLiteWebSearch },
  { name: "qwant", fn: qwantWebSearch },
  { name: "mojeek", fn: mojeekWebSearch },
];

const WAVE2: Provider[] = [
  { name: "google-news", fn: googleNewsSearch },
  { name: "wikipedia", fn: wikipediaSearch },
];

/**
 * Provider-agnostic web search. Runs each wave in parallel, returns the
 * first provider (by priority order) that produced results. Throws only
 * when every provider across both waves fails.
 */
export async function webSearchAny(
  query: string,
  recencyDays?: number
): Promise<{ results: DdgWebResult[]; provider: string }> {
  const errors: string[] = [];

  for (const wave of [WAVE1, WAVE2]) {
    const settled = await Promise.allSettled(wave.map((p) => p.fn(query, recencyDays)));
    for (let i = 0; i < wave.length; i++) {
      const s = settled[i];
      if (s.status === "fulfilled" && s.value.length > 0) {
        return { results: s.value, provider: wave[i].name };
      }
      errors.push(
        s.status === "rejected"
          ? `${wave[i].name}: ${(s.reason as Error)?.message || "hata"}`
          : `${wave[i].name}: boş`
      );
    }
  }

  throw new Error(`Tüm arama sağlayıcıları başarısız (${errors.join(" | ")})`);
}

/* ------------------------------------------------------------------ */
/* Images                                                              */
/* ------------------------------------------------------------------ */

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
      title?: string;
      url?: string;
      width?: number;
      height?: number;
    }>;
  };

  return (data.results || [])
    .filter((r) => r.image && r.image.startsWith("http"))
    .slice(0, 60)
    .map((r) => ({
      original_url: r.image as string,
      caption: r.title || "",
      source: hostOf(r.url || ""),
      original_width: r.width ? String(r.width) : "",
      original_height: r.height ? String(r.height) : "",
    }));
}

/** Qwant image API — fallback for image search. */
export async function qwantImageSearch(query: string): Promise<DdgImageResult[]> {
  const params = new URLSearchParams({
    q: query,
    count: "40",
    locale: "tr_tr",
    offset: "0",
    device: "desktop",
    safesearch: "1",
  });
  const res = (await fetchJson(
    `https://api.qwant.com/v3/search/images?${params.toString()}`
  )) as {
    data?: {
      result?: {
        items?: {
          mainline?: Array<{
            type?: string;
            items?: Array<{
              media?: string;
              thumbnail?: string;
              title?: string;
              url?: string;
              width?: number;
              height?: number;
            }>;
          }>;
        };
      };
    };
  };

  const out: DdgImageResult[] = [];
  for (const block of res?.data?.result?.items?.mainline || []) {
    for (const item of block?.items || []) {
      if (!item.media || !item.media.startsWith("http")) continue;
      out.push({
        original_url: item.media,
        caption: item.title || "",
        source: hostOf(item.url || ""),
        original_width: item.width ? String(item.width) : "",
        original_height: item.height ? String(item.height) : "",
      });
      if (out.length >= 60) break;
    }
  }
  return out;
}

/** Wikimedia Commons API — fully open, keyless image search. */
export async function commonsImageSearch(query: string): Promise<DdgImageResult[]> {
  const params = new URLSearchParams({
    action: "query",
    generator: "search",
    gsrsearch: query,
    gsrnamespace: "6",
    gsrlimit: "40",
    prop: "imageinfo",
    iiprop: "url|size",
    iiurlwidth: "600",
    format: "json",
    origin: "*",
  });
  const res = (await fetchJson(`https://commons.wikimedia.org/w/api.php?${params.toString()}`, {
    // Wikimedia asks for an identifiable User-Agent (browser-spoofing gets 403)
    headers: {
      "User-Agent": "JaraSearch/1.0 (https://jara-xi.vercel.app; search engine project)",
      "Api-User-Agent": "JaraSearch/1.0 (https://jara-xi.vercel.app; search engine project)",
    },
  })) as {
    query?: {
      pages?: Record<
        string,
        {
          title?: string;
          imageinfo?: Array<{
            url?: string;
            descriptionurl?: string;
            width?: number;
            height?: number;
          }>;
        }
      >;
    };
  };

  const pages = Object.values(res?.query?.pages || {});
  return pages
    .map((p) => {
      const info = p.imageinfo?.[0];
      const ext = (p.title || "").split(".").pop()?.toLowerCase() || "";
      if (!["jpg", "jpeg", "png", "webp"].includes(ext)) return null;
      return {
        original_url: info?.url || "",
        caption: (p.title || "").replace(/^File:| \.\w+$/g, "").replace(/\.\w+$/, ""),
        source: "commons.wikimedia.org",
        original_width: info?.width ? String(info.width) : "",
        original_height: info?.height ? String(info.height) : "",
      };
    })
    .filter((r): r is DdgImageResult => r !== null && r.original_url.startsWith("http"))
    .slice(0, 60);
}

/* ------------------------------------------------------------------ */
/* Suggestions                                                         */
/* ------------------------------------------------------------------ */

/** Autocomplete suggestions via DuckDuckGo's /ac/ endpoint. */
export async function ddgSuggest(query: string): Promise<string[]> {
  const params = new URLSearchParams({ q: query, type: "list" });
  const json = await fetchText(`https://duckduckgo.com/ac/?${params.toString()}`);
  const data = JSON.parse(json) as unknown;

  if (Array.isArray(data) && Array.isArray(data[1])) {
    return data[1].slice(0, 8);
  }
  return [];
}

/** Qwant suggest — fallback for autocomplete. */
export async function qwantSuggest(query: string): Promise<string[]> {
  const params = new URLSearchParams({ q: query, locale: "tr_tr" });
  const res = (await fetchJson(
    `https://api.qwant.com/v3/suggest?${params.toString()}`
  )) as { data?: Array<{ phrase?: string }> | { items?: Array<{ phrase?: string }> } };

  const items = Array.isArray(res?.data)
    ? res.data
    : (res?.data as { items?: Array<{ phrase?: string }> })?.items || [];
  return items
    .map((i) => i?.phrase || "")
    .filter((s) => s.length > 0)
    .slice(0, 8);
}
