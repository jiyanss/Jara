import * as cheerio from "cheerio";

/**
 * Multi-provider search layer — keyless, works in ANY environment
 * (local dev, Vercel, Docker...). Used as the automatic fallback
 * when z-ai-web-dev-sdk is unavailable (e.g. outside the Z.ai sandbox).
 *
 * Web search chain (parallel waves, priority-ordered):
 *   Wave 1: Brave (if BRAVE_API_KEY set) → Bing HTML → Bing RSS → DDG → DDG Lite
 *           → Qwant → Mojeek → Bing RSS (intl)
 *   Wave 2 (merged, not first-wins): Wikipedia (gate-passing, max 2) +
 *           Bing News + Google News — deduped, freshest first.
 *
 * The wave-2 merge exists because datacenter IPs (Vercel, AWS…) frequently
 * get blocked or served canned junk by the wave-1 HTML endpoints; the news
 * RSS + Wikipedia APIs are the only sources reachable from EVERYWHERE, so
 * instead of letting a single news feed take over, we present a mixed,
 * deduplicated, date-sorted page.
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

/** A plausible domain name ("hurriyet.com.tr" ok, "Hürriyet" not). */
function looksLikeHost(h: string): boolean {
  return !!h && h.includes(".") && !/\s/.test(h) && /^[a-zA-Z0-9.\-]+$/.test(h);
}

/** Map recency days to a provider-specific filter. */
function dfFromDays(days?: number): string | null {
  if (!days) return null;
  if (days <= 1) return "d";
  if (days <= 7) return "w";
  if (days <= 31) return "m";
  return "y";
}

const TR_MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
  // Turkish RFC-822 month abbreviations (Bing localized feeds)
  oca: 0, şub: 1, sub: 1, nis: 3, haz: 5, tem: 6,
  ağu: 7, agu: 7, eyl: 8, eki: 9, kas: 10, ara: 11,
};

/** Parse RSS pubDate in any locale ("Mon, 02 Nov 2026 ..." / "Pzt, 02 Kas 2026 ...") → ISO date. */
function parseRssDate(raw: string): string {
  if (!raw) return "";
  const s = raw.replace(/\s+/g, " ").trim();
  const numericFirst = s.match(/(\d{1,2}) ([A-Za-zÇĞİÖŞÜçğıöşü]{3}) (\d{4})/);
  const alphaFirst = s.match(/([A-Za-zÇĞİÖŞÜçğıöşü]{3}) (\d{1,2}),? (\d{4})/);
  let day = NaN;
  let mon = NaN;
  let year = NaN;
  if (numericFirst) {
    day = Number(numericFirst[1]);
    mon = TR_MONTHS[numericFirst[2].toLowerCase()];
    year = Number(numericFirst[3]);
  } else if (alphaFirst) {
    mon = TR_MONTHS[alphaFirst[1].toLowerCase()];
    day = Number(alphaFirst[2]);
    year = Number(alphaFirst[3]);
  }
  if (!isNaN(day) && !isNaN(mon) && !isNaN(year)) {
    return `${year}-${String(mon + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
}

function toResults(
  raw: Array<Omit<DdgWebResult, "rank" | "favicon"> & { favicon?: string }>
): DdgWebResult[] {
  const seen = new Set<string>();
  const out: DdgWebResult[] = [];
  for (const r of raw) {
    if (!r.url.startsWith("http") || !r.name || seen.has(r.url)) continue;
    // Bing feeds pad themselves with self-referential links
    // (bing.com/search?q=…) — never show those as "results".
    if (/^https?:\/\/(www\.)?bing\.com\/(search|news\/search)/i.test(r.url)) continue;
    // The URL hostname is the ground truth — a hand-set host_name may be a
    // publisher NAME (e.g. "Hürriyet") rather than a resolvable domain.
    const urlHost = hostOf(r.url);
    const host = looksLikeHost(urlHost)
      ? urlHost
      : looksLikeHost(r.host_name)
        ? r.host_name
        : "";
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

/**
 * Last-line defense applied to EVERY result set (ZAI + all fallback providers):
 * dedupe by URL, re-derive host_name from the URL hostname when possible and
 * always provide a favicon URL. Guarantees the UI never renders a mangled
 * `https://SourceName/…` style link line.
 */
export function normalizeResults(results: DdgWebResult[]): DdgWebResult[] {
  const seen = new Set<string>();
  const out: DdgWebResult[] = [];
  for (const r of Array.isArray(results) ? results : []) {
    const url = (r?.url || "").trim();
    if (!url.startsWith("http") || seen.has(url)) continue;
    seen.add(url);
    const urlHost = hostOf(url);
    const host = looksLikeHost(urlHost)
      ? urlHost
      : looksLikeHost(r.host_name || "")
        ? r.host_name
        : "";
    if (!host) continue;
    out.push({ ...r, url, host_name: host, favicon: faviconFor(host) });
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

/** Bing web-search RSS — keyless, bot-friendly, returns DIRECT article URLs. */
export async function bingWebSearch(
  query: string,
  _recencyDays?: number,
  intl = false
): Promise<DdgWebResult[]> {
  // NOTE: do NOT pass `mkt` — it badly skews results (e.g. "chatgpt" → quiz
  // widgets). `setlang` + `cc` localize safely (verified via A/B testing).
  const params = new URLSearchParams({ q: query, format: "rss" });
  if (!intl) {
    params.set("setlang", "tr");
    params.set("cc", "TR");
  }
  const xml = await fetchText(`https://www.bing.com/search?${params.toString()}`);
  const $ = cheerio.load(xml, { xmlMode: true });

  const raw: Array<Omit<DdgWebResult, "rank" | "favicon">> = [];
  $("item").each((_, el) => {
    const $el = $(el);
    const title = $el.find("title").first().text().replace(/\s+/g, " ").trim();
    const link = $el.find("link").first().text().trim();
    const snippet = stripTags($el.find("description").first().text() || "");
    raw.push({
      url: link,
      name: title,
      snippet,
      host_name: hostOf(link),
      date: parseRssDate($el.find("pubDate").first().text()),
    });
  });

  return toResults(raw);
}

/**
 * Decode Bing HTML redirect links: bing.com/ck/a?…&u=a1<base64url target>.
 * Returns "" when the link cannot be resolved to a real target.
 */
function decodeBingCkLink(href: string): string {
  try {
    const abs = href.startsWith("//") ? `https:${href}` : href;
    const u = new URL(abs, "https://www.bing.com");
    if (!/^\/(ck\/a)$/i.test(u.pathname)) {
      return abs.startsWith("http") ? abs : "";
    }
    const uParam = u.searchParams.get("u") || "";
    if (uParam.startsWith("a1")) {
      const b64 = uParam.slice(2).replace(/-/g, "+").replace(/_/g, "/");
      const decoded = Buffer.from(b64, "base64").toString("utf-8");
      if (decoded.startsWith("http")) return decoded;
    }
    return "";
  } catch {
    return "";
  }
}

/**
 * Bing web-search HTML — organic results for queries where the legacy RSS
 * feed returns nothing. Links arrive wrapped in bing.com/ck/a redirects and
 * are decoded to the real target URLs.
 */
export async function bingHtmlSearch(
  query: string,
  _recencyDays?: number
): Promise<DdgWebResult[]> {
  const params = new URLSearchParams({ q: query, count: "20", setlang: "tr", cc: "TR" });
  const html = await fetchText(`https://www.bing.com/search?${params.toString()}`);
  const $ = cheerio.load(html);

  const raw: Array<Omit<DdgWebResult, "rank" | "favicon">> = [];
  $("li.b_algo").each((_, el) => {
    const $el = $(el);
    const a = $el.find("h2 a").first();
    const url = decodeBingCkLink(a.attr("href") || "");
    const name = a.text().replace(/\s+/g, " ").trim();
    if (!url || !name) return;
    const snippet = stripTags(
      $el.find(".b_caption p").first().text() || $el.find("p").first().text() || ""
    );
    raw.push({ url, name, snippet, host_name: hostOf(url), date: "" });
  });

  return toResults(raw);
}

/** Bing News RSS — direct article URLs (the apiclick redirect wraps the target in `?url=`). */
export async function bingNewsSearch(query: string): Promise<DdgWebResult[]> {
  const params = new URLSearchParams({ q: query, format: "RSS" });
  const xml = await fetchText(`https://www.bing.com/news/search?${params.toString()}`);
  const $ = cheerio.load(xml, { xmlMode: true });

  const raw: Array<Omit<DdgWebResult, "rank" | "favicon">> = [];
  $("item").each((_, el) => {
    if (raw.length >= 25) return;
    const $el = $(el);
    const title = $el.find("title").first().text().replace(/\s+/g, " ").trim();
    const rawLink = $el.find("link").first().text().trim();
    const link = resolveBingNewsLink(rawLink);
    const snippet = stripTags($el.find("description").first().text() || "");
    // Source lives in the namespaced <News:Source> child
    let source = "";
    for (const child of $el.children().toArray()) {
      if ((child as { tagName?: string }).tagName?.toLowerCase() === "news:source") {
        source = $(child).text().replace(/\s+/g, " ").trim();
        break;
      }
    }
    raw.push({
      url: link,
      name: title,
      snippet,
      host_name: hostOf(link) || source,
      date: parseRssDate($el.find("pubDate").first().text()),
    });
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

/** Resolve Bing News redirect links: apiclick.aspx?...&url=<encoded target>. */
function resolveBingNewsLink(href: string): string {
  try {
    const u = new URL(href);
    const target = u.searchParams.get("url");
    if (target && target.startsWith("http")) return target;
    return href;
  } catch {
    return href;
  }
}

/** Remove the duplicated "Title … Source" blob Google News puts in <description>. */
function cleanNewsSnippet(desc: string, titleVariants: string[], source: string): string {
  let s = desc.replace(/\s+/g, " ").trim();
  for (const variant of titleVariants) {
    const t = variant.replace(/\s+/g, " ").trim();
    if (t && s.toLowerCase().startsWith(t.toLowerCase())) {
      s = s.slice(t.length).trim();
    }
  }
  const src = source.trim();
  if (src) {
    if (s.toLowerCase().startsWith(src.toLowerCase())) {
      s = s.slice(src.length).trim();
    }
    if (s.toLowerCase().endsWith(src.toLowerCase())) {
      s = s.slice(0, -src.length).trim();
    }
  }
  return s.replace(/^[·—–|:-]+\s*/, "").replace(/\s*[·—–|:-]+$/, "").trim();
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
    const sourceEl = $el.find("source").first();
    const sourceName = sourceEl.text().trim();
    const sourceUrl = sourceEl.attr("url") || "";
    const description = stripTags($el.find("description").first().text() || "");

    // "Başlık - Kaynak" → title + source
    const sep = titleFull.lastIndexOf(" - ");
    const name = sep > 0 ? titleFull.slice(0, sep) : titleFull;

    // Older item IDs decode to the real article URL; newer ones (AU_yqL…)
    // cannot be decoded locally and keep the news.google.com redirect (which
    // still resolves in a browser). Either way host_name must be a DOMAIN.
    const url = decodeGoogleNewsUrl(link);
    const host =
      hostOf(url) || hostOf(sourceUrl) || (looksLikeHost(sourceName) ? sourceName : "");

    raw.push({
      url,
      name,
      snippet:
        cleanNewsSnippet(description, [name, titleFull], sourceName) ||
        (sourceName ? `${sourceName} kaynağından haber.` : ""),
      host_name: host,
      date: parseRssDate(pubDate),
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

/**
 * Merge Bing News + Google News into one deduplicated stream.
 * Same article syndicated by both providers (same host + similar title) or
 * the exact same URL is collapsed to a single entry.
 */
function dedupeNews(items: DdgWebResult[]): DdgWebResult[] {
  const seenUrl = new Set<string>();
  const seenTitle = new Set<string>();
  const out: DdgWebResult[] = [];
  for (const r of items) {
    if (seenUrl.has(r.url)) continue;
    const tkey = `${r.host_name}|${r.name.toLowerCase().replace(/\s+/g, " ").slice(0, 48)}`;
    if (seenTitle.has(tkey)) continue;
    seenUrl.add(r.url);
    seenTitle.add(tkey);
    out.push(r);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Relevance gate                                                      */
/* ------------------------------------------------------------------ */

const TOKEN_SPLIT = /[^a-z0-9çğıöşüâêîû]+/;

/** How many results contain at least one query token (title/snippet/url)? */
function matchCount(results: DdgWebResult[], tokens: string[]): number {
  let n = 0;
  for (const r of results) {
    const hay = `${r.name} ${r.snippet} ${r.url}`.toLowerCase();
    if (tokens.some((t) => hay.includes(t))) n++;
  }
  return n;
}

/**
 * Reject result sets that have (almost) nothing to do with the query.
 * Bing's RSS endpoint serves canned/generic pages (weather, speedtest…)
 * for rare queries from datacenter IPs — this gate skips such providers
 * so the chain can try the next one instead of showing junk.
 */
export function looksRelevant(results: DdgWebResult[], query: string): boolean {
  const tokens = (query.toLowerCase().split(TOKEN_SPLIT) || [])
    .filter((t) => t.length >= 3)
    .slice(0, 8);
  if (tokens.length === 0) return true; // nothing to validate against
  const len = results.length;
  const need = Math.min(len, Math.max(2, Math.ceil(len * 0.2)));
  return matchCount(results, tokens) >= need;
}

/* ------------------------------------------------------------------ */
/* Orchestrator                                                        */
/* ------------------------------------------------------------------ */

interface Provider {
  name: string;
  fn: (q: string, days?: number) => Promise<DdgWebResult[]>;
}

export interface ProviderAttempt {
  provider: string;
  count: number;
  note?: string;
}

const WAVE1: Provider[] = [
  { name: "brave", fn: braveWebSearch },
  { name: "bing-html", fn: bingHtmlSearch },
  { name: "bing", fn: bingWebSearch },
  { name: "ddg", fn: ddgWebSearch },
  { name: "ddg-lite", fn: ddgLiteWebSearch },
  { name: "qwant", fn: qwantWebSearch },
  { name: "mojeek", fn: mojeekWebSearch },
  // Last Bing attempt without locale params — different canned-junk profile
  { name: "bing-intl", fn: (q: string) => bingWebSearch(q, undefined, true) },
];

const WAVE2: Provider[] = [
  { name: "bing-news", fn: bingNewsSearch },
  { name: "google-news", fn: googleNewsSearch },
  { name: "wikipedia", fn: wikipediaSearch },
];

/**
 * Provider-agnostic web search.
 *
 * Wave 1 runs all general web providers in parallel; the first one (by
 * priority order) whose results pass the relevance gate wins.
 *
 * Wave 2 is a MERGE, not a race: Wikipedia (only gate-passing entries, max 2)
 * is prepended to a deduplicated Bing News + Google News stream sorted
 * freshest-first. This guarantees that even from locked-down datacenter IPs
 * (where every wave-1 HTML endpoint tends to be blocked) the user still gets
 * a sensible mixed page instead of a single stale news feed.
 *
 * Throws only when every provider errored/returned nothing; returns
 * `{ results: [], provider: "irrelevant" }` when results came back but NONE
 * of them related to the query (the caller shows an honest "no results").
 */
export async function webSearchAny(
  query: string,
  recencyDays?: number
): Promise<{ results: DdgWebResult[]; provider: string; attempts: ProviderAttempt[] }> {
  const errors: string[] = [];
  const attempts: ProviderAttempt[] = [];
  const tokens = (query.toLowerCase().split(TOKEN_SPLIT) || [])
    .filter((t) => t.length >= 3)
    .slice(0, 8);
  let best: { results: DdgWebResult[]; provider: string; matched: number } | null = null;

  const gateCheck = (name: string, value: DdgWebResult[]): boolean => {
    // Query has no usable tokens (very short / punctuation only) → accept as-is
    if (tokens.length === 0) return true;
    const matched = matchCount(value, tokens);
    const need = Math.min(value.length, Math.max(2, Math.ceil(value.length * 0.2)));
    if (matched >= need) return true;
    if (!best || matched > best.matched) {
      best = { results: value, provider: name, matched };
    }
    errors.push(`${name}: alakasız (${matched}/${value.length})`);
    attempts.push({ provider: name, count: value.length, note: `alakasız ${matched}/${value.length}` });
    return false;
  };

  // ---- Wave 1: general web providers, first gate-passing set wins --------
  {
    const settled = await Promise.allSettled(
      WAVE1.map((p) => p.fn(query, recencyDays))
    );
    for (let i = 0; i < WAVE1.length; i++) {
      const s = settled[i];
      if (s.status !== "fulfilled" || s.value.length === 0) {
        const note =
          s.status === "rejected"
            ? (s.reason as Error)?.message || "hata"
            : "boş";
        errors.push(`${WAVE1[i].name}: ${note.slice(0, 80)}`);
        attempts.push({ provider: WAVE1[i].name, count: 0, note: note.slice(0, 80) });
        continue;
      }
      attempts.push({ provider: WAVE1[i].name, count: s.value.length });
      if (gateCheck(WAVE1[i].name, s.value)) {
        return { results: s.value, provider: WAVE1[i].name, attempts };
      }
    }
  }

  // ---- Wave 2: MERGED fallback (Wikipedia + Bing News + Google News) -----
  {
    const settled = await Promise.allSettled(
      WAVE2.map((p) => p.fn(query, recencyDays))
    );
    const byName: Record<string, DdgWebResult[]> = {};
    for (let i = 0; i < WAVE2.length; i++) {
      const s = settled[i];
      const name = WAVE2[i].name;
      if (s.status !== "fulfilled" || s.value.length === 0) {
        const note =
          s.status === "rejected"
            ? (s.reason as Error)?.message || "hata"
            : "boş";
        errors.push(`${name}: ${note.slice(0, 80)}`);
        attempts.push({ provider: name, count: 0, note: note.slice(0, 80) });
        byName[name] = [];
        continue;
      }
      byName[name] = s.value;
      attempts.push({ provider: name, count: s.value.length });
    }

    // Wikipedia entries that individually mention the query (max 2, on top)
    const wikiTop = (byName["wikipedia"] || [])
      .filter((r) => tokens.length === 0 || matchCount([r], tokens) > 0)
      .slice(0, 2);

    // News: merged, deduped, freshest first (empty dates sink to the end)
    const news = dedupeNews([
      ...(byName["bing-news"] || []),
      ...(byName["google-news"] || []),
    ]);
    if (!recencyDays) {
      news.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    }

    const mixed = [...wikiTop, ...news];
    if (mixed.length > 0) {
      attempts.push({ provider: "news-mix", count: mixed.length });
      if (gateCheck("news-mix", mixed)) {
        return { results: mixed, provider: "news-mix", attempts };
      }
    }
  }

  // Every provider failed the relevance gate. Return the least-bad set if it
  // at least mentions the query a couple of times, else "no results".
  if (best && best.matched >= 2) {
    return { results: best.results, provider: best.provider, attempts };
  }
  if (best) {
    return { results: [], provider: "irrelevant", attempts };
  }
  // Not a single provider returned data — genuinely unreachable.
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
