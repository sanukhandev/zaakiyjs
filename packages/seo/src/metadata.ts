import type { AuditOptions, HeadTag, Metadata, MetadataDefinition, PageMetadataContext, RenderedMetadata,
  ResolveMetadataOptions, ResolvedMetadata, RobotsDirectives, SeoDiagnostic } from "./types.js";
import { escapeHtml, normalizeCanonical } from "./url.js";
import { serializeJsonLd, validateStructuredData } from "./structured.js";

export function defineMetadata<const T extends Metadata>(input: T): T { return input; }
export function definePageMetadata<Data, Params extends Readonly<Record<string, string>> = Readonly<Record<string, string>>>(
  input: MetadataDefinition<Data, Params>
): MetadataDefinition<Data, Params> { return input; }
export function resolveMetadata<Data = unknown, Params extends Readonly<Record<string, string>> = Readonly<Record<string, string>>>(
  layers: readonly MetadataDefinition<Data, Params>[],
  options: ResolveMetadataOptions<Data, Params>
): ResolvedMetadata {
  let merged: Metadata = {};
  const context: PageMetadataContext<Data, Params> = {
    data: options.data as Data, params: (options.params ?? {}) as Params,
    locale: options.locale, status: options.status
  };
  for (const layer of layers) {
    const value = typeof layer === "function" ? layer(context) : layer;
    if (!value || typeof value !== "object") throw new TypeError("Metadata resolver must return an object");
    merged = {
      ...merged, ...value,
      robots: { ...merged.robots, ...value.robots },
      openGraph: { ...merged.openGraph, ...value.openGraph },
      twitter: { ...merged.twitter, ...value.twitter },
      alternates: { ...merged.alternates, ...value.alternates }
    };
  }
  const robots: RobotsDirectives = {
    index: true, follow: true, ...merged.robots
  };
  // For non-200 or private responses, never serialize loader-derived discovery content.
  // This protects older convenience metadata APIs as well as the P3 resolver.
  const notIndexable = options.private === true ||
    (options.status !== undefined && options.status !== 200);
  const forcedRobots = notIndexable ? { ...robots, index: false, follow: false } : robots;
  if (notIndexable) {
    return {
      robots: forcedRobots as ResolvedMetadata["robots"],
      title: options.private ? undefined : options.status && options.status >= 400 ? merged.title : undefined,
      locale: options.locale ?? merged.locale
    };
  }
  const canonical = merged.canonical === undefined ? undefined : normalizeCanonical(merged.canonical, options);
  const altEntries = Object.entries(merged.alternates ?? {}).map(([locale, href]) =>
    [locale, normalizeCanonical(href, options)] as const);
  const alternates = altEntries.length ? Object.fromEntries(altEntries.sort(([a], [b]) => a.localeCompare(b))) : undefined;
  return {
    ...merged, canonical, robots: forcedRobots as ResolvedMetadata["robots"], alternates,
    openGraph: merged.openGraph ? {
      ...merged.openGraph,
      ...(merged.openGraph.image ? { image: normalizeCanonical(merged.openGraph.image, options) } : {})
    } : undefined,
    twitter: merged.twitter ? {
      ...merged.twitter,
      ...(merged.twitter.image ? { image: normalizeCanonical(merged.twitter.image, options) } : {})
    } : undefined,
    locale: options.locale ?? merged.locale
  };
}
export function robotsContent(robots: RobotsDirectives): string {
  const directives = [
    robots.index === false ? "noindex" : "index",
    robots.follow === false ? "nofollow" : "follow",
    robots.noarchive ? "noarchive" : undefined,
    robots.nosnippet ? "nosnippet" : undefined,
    robots.noimageindex ? "noimageindex" : undefined
  ];
  return directives.filter((entry): entry is string => Boolean(entry)).join(", ");
}
const meta = (key: string, name: string, content: string, property = false): HeadTag => ({
  kind: "meta", key, attributes: { [property ? "property" : "name"]: name, content }
});
export function metadataToTags(metadata: ResolvedMetadata): readonly HeadTag[] {
  const tags: HeadTag[] = [];
  if (metadata.title !== undefined) tags.push({ kind: "title", key: "title", text: metadata.title });
  if (metadata.description !== undefined) tags.push(meta("description", "description", metadata.description));
  if (metadata.canonical !== undefined) tags.push({ kind: "link", key: "canonical", attributes: { rel: "canonical", href: metadata.canonical } });
  tags.push(meta("robots", "robots", robotsContent(metadata.robots)));
  if (metadata.author) tags.push(meta("author", "author", metadata.author));
  if (metadata.publisher) tags.push(meta("publisher", "publisher", metadata.publisher));
  if (metadata.openGraph?.title) tags.push(meta("og:title", "og:title", metadata.openGraph.title, true));
  if (metadata.openGraph?.description) tags.push(meta("og:description", "og:description", metadata.openGraph.description, true));
  if (metadata.openGraph?.image) tags.push(meta("og:image", "og:image", metadata.openGraph.image, true));
  if (metadata.openGraph?.type) tags.push(meta("og:type", "og:type", metadata.openGraph.type, true));
  if (metadata.openGraph?.siteName) tags.push(meta("og:site_name", "og:site_name", metadata.openGraph.siteName, true));
  if (metadata.twitter?.card) tags.push(meta("twitter:card", "twitter:card", metadata.twitter.card));
  if (metadata.twitter?.title) tags.push(meta("twitter:title", "twitter:title", metadata.twitter.title));
  if (metadata.twitter?.description) tags.push(meta("twitter:description", "twitter:description", metadata.twitter.description));
  if (metadata.twitter?.image) tags.push(meta("twitter:image", "twitter:image", metadata.twitter.image));
  if (metadata.twitter?.site) tags.push(meta("twitter:site", "twitter:site", metadata.twitter.site));
  if (metadata.twitter?.creator) tags.push(meta("twitter:creator", "twitter:creator", metadata.twitter.creator));
  for (const [locale, href] of Object.entries(metadata.alternates ?? {})) {
    tags.push({ kind: "link", key: "hreflang:" + locale, attributes: { rel: "alternate", hreflang: locale, href } });
  }
  if (metadata.structuredData) {
    tags.push({ kind: "script", key: "jsonld", attributes: { type: "application/ld+json" },
      text: serializeJsonLd(metadata.structuredData) });
  }
  return tags;
}
export function serializeHeadTags(tags: readonly HeadTag[]): string {
  const keys = new Set<string>();
  return tags.map(tag => {
    if (keys.has(tag.key)) throw new TypeError("Duplicate SEO head tag key: " + tag.key);
    keys.add(tag.key);
    if (tag.kind === "title") return "<title>" + escapeHtml(tag.text) + "</title>";
    const attrs = Object.entries(tag.attributes).map(([key, value]) => " " + key + '="' + escapeHtml(value) + '"').join("");
    if (tag.kind === "script") return "<script" + attrs + ">" + tag.text + "</script>";
    return "<" + tag.kind + attrs + ">";
  }).join("\n");
}
export function renderMetadata<Data = unknown, Params extends Readonly<Record<string, string>> = Readonly<Record<string, string>>>(
  metadata: MetadataDefinition<Data, Params> | readonly MetadataDefinition<Data, Params>[],
  options: ResolveMetadataOptions<Data, Params>
): RenderedMetadata {
  const resolved = resolveMetadata(Array.isArray(metadata) ? metadata : [metadata as MetadataDefinition<Data, Params>], options);
  const tags = metadataToTags(resolved);
  return { metadata: resolved, tags, html: serializeHeadTags(tags),
    headers: { "X-Robots-Tag": robotsContent(resolved.robots) } };
}
export function auditMetadata(metadata: ResolvedMetadata, options: AuditOptions = {}): readonly SeoDiagnostic[] {
  const diagnostics: SeoDiagnostic[] = [];
  const add = (code: string, severity: SeoDiagnostic["severity"], message: string): void => {
    diagnostics.push({ code, severity, message });
  };
  if (!metadata.title?.trim()) add("SEO001", "error", "Missing or empty page title");
  if (!metadata.description?.trim()) add("SEO002", "warning", "Missing or empty description");
  else if (metadata.description.trim().length < 50) add("SEO003", "info", "Description may be too brief");
  if (!metadata.canonical && metadata.robots.index) add("SEO004", "warning", "Indexable page has no canonical");
  if (options.private && metadata.robots.index) add("SEO005", "error", "Private page must not be indexable");
  if (options.status !== undefined && options.status >= 400 && metadata.robots.index)
    add("SEO006", "error", "Error status conflicts with indexable metadata");
  if (options.sitemapIncluded && (!metadata.robots.index || options.private))
    add("SEO007", "error", "Noindex or private page appears in sitemap");
  if (!metadata.openGraph?.image) add("SEO008", "info", "No Open Graph preview image");
  const tags = options.existingTags ?? [];
  if (tags.filter(t => t.key === "canonical" || t.kind === "link" &&
      t.attributes.rel === "canonical").length > 1)
    add("SEO009", "error", "Duplicate canonical links");
  if (metadata.structuredData) {
    try { validateStructuredData(metadata.structuredData); }
    catch (error) { add("SEO010", "error", String(error)); }
  }
  for (const [locale, href] of Object.entries(metadata.alternates ?? {})) {
    if (locale !== "x-default" && !/^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8})*$/.test(locale))
      add("SEO011", "error", "Invalid hreflang locale: " + locale);
    if (!/^https?:\/\//.test(href)) add("SEO012", "error", "Invalid hreflang URL");
  }
  return diagnostics;
}
