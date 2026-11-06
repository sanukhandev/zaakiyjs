import { escapeXml, normalizeCanonical } from "./url.js";
import type { CanonicalPolicy, SeoDiagnostic } from "./types.js";

export interface SitemapEntry {
  readonly loc: string;
  readonly lastmod?: string | Date;
  readonly changefreq?: "always" | "hourly" | "daily" | "weekly" | "monthly" | "yearly" | "never";
  readonly priority?: number;
  readonly alternates?: Readonly<Record<string, string>>;
  /** Content must be published, public, authorized, and indexable. */
  readonly published?: boolean;
  readonly private?: boolean;
  readonly authorized?: boolean;
  readonly noindex?: boolean;
  readonly status?: number;
  readonly redirect?: boolean;
  readonly soft404?: boolean;
}
export interface SitemapOptions extends CanonicalPolicy {
  readonly prefix?: string;
  readonly maxEntries?: number;
  readonly maxBytes?: number;
  /** Maximum total feed records to traverse, including filtered records. */
  readonly maxRecords?: number;
}
export interface GeneratedSitemap {
  readonly filename: string;
  readonly xml: string;
  readonly count: number;
  readonly urls: readonly string[];
}
export interface SitemapIndexEntry { readonly loc: string; readonly lastmod?: string | Date }
export interface SitemapBuild {
  readonly files: readonly GeneratedSitemap[];
  readonly index?: string;
  readonly excluded: number;
}
const XML_HEADER = '<?xml version="1.0" encoding="UTF-8"?>\n';
const NS = "http://www.sitemaps.org/schemas/sitemap/0.9";
const XHTML_NS = "http://www.w3.org/1999/xhtml";
const ENCODER = new TextEncoder();
function dateString(value: string | Date | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (value instanceof Date) {
    if (Number.isNaN(value.valueOf())) throw new TypeError("Invalid lastmod date");
    return value.toISOString();
  }
  if (!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2}))?$/.test(value)
    || Number.isNaN(Date.parse(value))) throw new TypeError("Invalid lastmod date");
  // Date.parse can normalize impossible dates such as February 30.
  const [yearText, monthText, dayText] = value.slice(0, 10).split("-");
  const year = Number(yearText), month = Number(monthText), day = Number(dayText);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > (days[month - 1] ?? 0))
    throw new TypeError("Invalid lastmod calendar date");
  return value;
}
function serializedEntry(entry: SitemapEntry, options: SitemapOptions): { loc: string; xml: string } {
  const loc = normalizeCanonical(entry.loc, options);
  if (loc.length >= 2_048) throw new RangeError("Sitemap URL must be fewer than 2048 characters");
  let body = "<url><loc>" + escapeXml(loc) + "</loc>";
  const date = dateString(entry.lastmod);
  if (date) body += "<lastmod>" + escapeXml(date) + "</lastmod>";
  if (entry.changefreq !== undefined) {
    if (!["always", "hourly", "daily", "weekly", "monthly", "yearly", "never"].includes(entry.changefreq)) {
      throw new TypeError("Invalid sitemap changefreq");
    }
    body += "<changefreq>" + entry.changefreq + "</changefreq>";
  }
  if (entry.priority !== undefined) {
    if (!Number.isFinite(entry.priority) || entry.priority < 0 || entry.priority > 1) {
      throw new TypeError("Invalid sitemap priority");
    }
    body += "<priority>" + entry.priority.toFixed(1) + "</priority>";
  }
  for (const [locale, url] of Object.entries(entry.alternates ?? {}).sort(([a], [b]) => a.localeCompare(b))) {
    if (locale !== "x-default" && !/^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8})*$/.test(locale)) throw new TypeError("Invalid locale: " + locale);
    const target = normalizeCanonical(url, options);
    body += '<xhtml:link rel="alternate" hreflang="' + escapeXml(locale) +
      '" href="' + escapeXml(target) + '"/>';
  }
  return { loc, xml: body + "</url>" };
}
function eligible(entry: SitemapEntry): boolean {
  return entry.published !== false && entry.authorized !== false && entry.private !== true &&
    entry.noindex !== true && entry.redirect !== true && entry.soft404 !== true &&
    (entry.status === undefined || entry.status === 200);
}
export async function generateSitemaps(
  source: Iterable<SitemapEntry> | AsyncIterable<SitemapEntry>,
  options: SitemapOptions
): Promise<SitemapBuild> {
  const maxEntries = options.maxEntries ?? 50_000;
  const maxBytes = options.maxBytes ?? 50_000_000;
  const maxRecords = options.maxRecords ?? 100_000;
  if (!Number.isInteger(maxEntries) || maxEntries < 1 || maxEntries > 50_000 ||
    !Number.isInteger(maxBytes) || maxBytes < 1024 || maxBytes > 50_000_000 ||
    !Number.isSafeInteger(maxRecords) || maxRecords < 1 || maxRecords > 1_000_000) {
    throw new RangeError("Sitemap limits must respect 50,000 URLs, 50 MB, and bounded feed records");
  }
  const seen = new Map<string, string>();
  const entries: { loc: string; xml: string }[] = [];
  let excluded = 0;
  let processed = 0;
  for await (const entry of source) {
    if (++processed > maxRecords) throw new RangeError("Sitemap source exceeds maxRecords");
    if (!eligible(entry)) { excluded++; continue; }
    const item = serializedEntry(entry, options);
    const previous = seen.get(item.loc);
    if (previous !== undefined) {
      if (previous !== item.xml) throw new TypeError("Conflicting metadata for duplicate sitemap canonical");
      excluded++;
      continue;
    }
    seen.set(item.loc, item.xml);
    entries.push(item);
  }
  entries.sort((a, b) => a.loc.localeCompare(b.loc, "en"));
  const header = XML_HEADER + '<urlset xmlns="' + NS + '" xmlns:xhtml="' + XHTML_NS + '">\n';
  const footer = "\n</urlset>";
  const overhead = ENCODER.encode(header + footer).length;
  const chunks: { body: string[]; urls: string[]; bytes: number }[] = [];
  let current: { body: string[]; urls: string[]; bytes: number } = { body: [], urls: [], bytes: overhead };
  for (const entry of entries) {
    const byteCount = ENCODER.encode(entry.xml + "\n").length;
    if (byteCount + overhead > maxBytes) throw new RangeError("Single sitemap entry exceeds maxBytes");
    if (current.body.length && (current.body.length === maxEntries || current.bytes + byteCount > maxBytes)) {
      chunks.push(current);
      current = { body: [], urls: [], bytes: overhead };
    }
    current.body.push(entry.xml);
    current.urls.push(entry.loc);
    current.bytes += byteCount;
  }
  if (current.body.length || !chunks.length) chunks.push(current);
  const prefix = options.prefix ?? "sitemap";
  if (!/^[a-zA-Z0-9_-]+$/.test(prefix)) throw new TypeError("Unsafe sitemap filename");
  const files = chunks.map((chunk, index) => ({
    filename: chunks.length === 1 ? prefix + ".xml" : prefix + "-" + (index + 1) + ".xml",
    xml: header + chunk.body.join("\n") + footer,
    count: chunk.body.length, urls: chunk.urls
  }));
  const index = files.length > 1 ? generateSitemapIndex(
    files.map(file => ({ loc: "/" + file.filename })), options
  ) : undefined;
  return { files, index, excluded };
}
export function generateSitemapIndex(entries: readonly SitemapIndexEntry[], options: CanonicalPolicy): string {
  if (entries.length > 50_000) throw new RangeError("Sitemap index exceeds 50,000 locations");
  const sorted = entries.map(entry => {
    const loc = normalizeCanonical(entry.loc, options);
    if (loc.length >= 2_048) throw new RangeError("Sitemap index URL must be fewer than 2048 characters");
    return { loc, lastmod: dateString(entry.lastmod) };
  }).sort((a, b) => a.loc.localeCompare(b.loc, "en"));
  const unique = new Set<string>();
  const rows = sorted.map(({ loc, lastmod }) => {
    if (unique.has(loc)) throw new TypeError("Duplicate sitemap index location");
    unique.add(loc);
    return "<sitemap><loc>" + escapeXml(loc) + "</loc>" +
      (lastmod ? "<lastmod>" + escapeXml(lastmod) + "</lastmod>" : "") + "</sitemap>";
  });
  const xml = XML_HEADER + '<sitemapindex xmlns="' + NS + '">\n' + rows.join("\n") + "\n</sitemapindex>";
  if (ENCODER.encode(xml).length > 50_000_000) throw new RangeError("Sitemap index exceeds 50 MB");
  return xml;
}
export function planSitemapRebuild(
  previous: Readonly<Record<string, string>>, next: Readonly<Record<string, string>>
): { readonly changed: readonly string[]; readonly removed: readonly string[] } {
  const changed = Object.keys(next).filter(id => next[id] !== previous[id]).sort();
  const removed = Object.keys(previous).filter(id => !Object.hasOwn(next, id)).sort();
  return { changed, removed };
}
export interface HreflangPage {
  readonly loc: string;
  readonly alternates: Readonly<Record<string, string>>;
}
export function auditHreflang(pages: readonly HreflangPage[], policy: CanonicalPolicy): readonly SeoDiagnostic[] {
  const result: SeoDiagnostic[] = [];
  const byUrl = new Map<string, HreflangPage>();
  for (const page of pages) byUrl.set(normalizeCanonical(page.loc, policy), page);
  for (const page of pages) {
    const source = normalizeCanonical(page.loc, policy);
    for (const [locale, href] of Object.entries(page.alternates)) {
      if (locale !== "x-default" && !/^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8})*$/.test(locale))
        result.push({ code: "SEO201", severity: "error", message: "Invalid locale: " + locale, path: source });
      const dest = normalizeCanonical(href, policy);
      const other = byUrl.get(dest);
      if (other && !Object.values(other.alternates).some(value => normalizeCanonical(value, policy) === source))
        result.push({ code: "SEO202", severity: "warning", message: "Missing reciprocal alternate: " + dest, path: source });
    }
  }
  return result;
}
