import { normalizeCanonical } from "./url.js";
import { serializeJsonLd } from "./structured.js";
import { generateSitemaps } from "./sitemap.js";
import type { CanonicalPolicy } from "./types.js";
import type { SitemapBuild, SitemapEntry } from "./sitemap.js";

export type JsonLdValueV1 = null | string | number | boolean |
  readonly JsonLdValueV1[] | { readonly [key: string]: JsonLdValueV1 };
export interface SeoRobotsV1 {
  readonly index?: boolean;
  readonly follow?: boolean;
  readonly noarchive?: boolean;
  readonly nosnippet?: boolean;
  readonly maxSnippet?: number;
  readonly maxImagePreview?: "none" | "standard" | "large";
}
export interface SeoDocumentV1 {
  readonly version: 1;
  readonly title?: string;
  readonly description?: string;
  readonly canonical?: string;
  readonly robots?: SeoRobotsV1;
  readonly openGraph?: {
    readonly type?: "website" | "article" | "product";
    readonly title?: string;
    readonly description?: string;
    readonly url?: string;
    readonly siteName?: string;
    readonly images?: readonly { readonly url: string; readonly alt?: string; readonly width?: number; readonly height?: number }[];
  };
  readonly social?: {
    readonly card?: "summary" | "summary_large_image";
    readonly title?: string;
    readonly description?: string;
    readonly image?: string;
    readonly imageAlt?: string;
  };
  readonly locale?: string;
  readonly alternates?: readonly { readonly hreflang: string; readonly url: string }[];
  readonly jsonLd?: readonly JsonLdValueV1[];
}
export interface SeoResolveInputV1<Data = unknown> {
  readonly routeId: string;
  readonly url: URL;
  readonly params: Readonly<Record<string, string>>;
  readonly loaderData: Data;
  readonly status: number;
  readonly visibility: "public" | "private" | "draft";
  readonly siteOrigin: URL;
}
export type SeoFactoryV1<Data> = (input: SeoResolveInputV1<Data>) => SeoDocumentV1 | Promise<SeoDocumentV1>;
export interface SeoResolutionV1 {
  readonly version: 1;
  readonly status: number;
  readonly metadata: SeoDocumentV1;
  readonly redirect?: { readonly status: 301 | 302 | 307 | 308; readonly location: string };
}
export interface SitemapEntryV1 {
  readonly loc: string;
  readonly lastmod?: string;
  readonly changefreq?: "always" | "hourly" | "daily" | "weekly" | "monthly" | "yearly" | "never";
  readonly priority?: number;
  readonly alternates?: readonly { readonly hreflang: string; readonly url: string }[];
  readonly visibility: "public";
}
export interface SitemapFeedV1 {
  readonly schema: "zaakiy.sitemap/1";
  entries(input: { readonly signal: AbortSignal; readonly cursor?: string }): Promise<{
    readonly items: readonly SitemapEntryV1[];
    readonly nextCursor?: string;
  }>;
}
export interface RenderHeadEntryV1 {
  readonly tag: "title" | "meta" | "link" | "script-jsonld";
  readonly attributes?: Readonly<Record<string, string>>;
  readonly text?: string;
}
export interface RenderHeadAdapterV1 {
  readonly version: 1;
  resolve(input: { readonly routeId: string; readonly url: URL; readonly status: number;
    readonly loaderData: unknown }): Promise<readonly RenderHeadEntryV1[]> | readonly RenderHeadEntryV1[];
}
export interface SeoResolveOptionsV1 {
  readonly defaults?: SeoDocumentV1;
  readonly layouts?: readonly SeoDocumentV1[];
  readonly allowedOrigins?: readonly string[];
  readonly trailingSlash?: CanonicalPolicy["trailingSlash"];
  readonly query?: CanonicalPolicy["query"];
  readonly redirect?: { readonly status: 301 | 302 | 307 | 308; readonly location: string };
}
function assertVersion(document: SeoDocumentV1): void {
  if (!document || document.version !== 1) throw new TypeError("Expected zaakiy.seo/1 document");
}
function normalizeTarget(value: string, policy: CanonicalPolicy): string {
  const result = normalizeCanonical(value, policy);
  if (!result.startsWith("https://")) throw new TypeError("SEO v1 requires HTTPS URLs");
  return result;
}
function validateLocale(value: string): string {
  if (value === "x-default") return value;
  try {
    const values = Intl.getCanonicalLocales(value);
    if (values.length !== 1 || !/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(value)) throw new TypeError("Invalid locale");
    return values[0]!;
  } catch { throw new TypeError("Invalid BCP 47 SEO locale: " + value); }
}
function mergeDoc(parent: SeoDocumentV1, next: SeoDocumentV1): SeoDocumentV1 {
  assertVersion(next);
  return {
    ...parent, ...next,
    robots: { ...parent.robots, ...next.robots },
    openGraph: { ...parent.openGraph, ...next.openGraph },
    social: { ...parent.social, ...next.social },
    alternates: next.alternates ?? parent.alternates,
    jsonLd: next.jsonLd ?? parent.jsonLd
  };
}
function normalizeDoc(document: SeoDocumentV1, input: SeoResolveInputV1, options: SeoResolveOptionsV1): SeoDocumentV1 {
  const policy: CanonicalPolicy = {
    siteURL: input.siteOrigin.origin,
    allowedOrigins: options.allowedOrigins,
    trailingSlash: options.trailingSlash,
    query: options.query
  };
  const canonical = normalizeTarget(document.canonical ?? input.url.pathname + input.url.search, policy);
  const images = new Map<string, { url: string; alt?: string; width?: number; height?: number }>();
  for (const image of document.openGraph?.images ?? []) {
    const url = normalizeTarget(image.url, policy);
    for (const dim of [image.width, image.height]) {
      if (dim !== undefined && (!Number.isSafeInteger(dim) || dim <= 0)) throw new TypeError("Invalid Open Graph dimensions");
    }
    if (!images.has(url)) images.set(url, { ...image, url });
  }
  const alternates = new Map<string, string>();
  for (const alt of document.alternates ?? []) {
    const lang = validateLocale(alt.hreflang);
    const url = normalizeTarget(alt.url, policy);
    if (alternates.has(lang) && alternates.get(lang) !== url) throw new TypeError("Conflicting hreflang alternate: " + lang);
    alternates.set(lang, url);
  }
  if (document.locale) validateLocale(document.locale);
  if (document.robots?.maxSnippet !== undefined &&
     (!Number.isInteger(document.robots.maxSnippet) || document.robots.maxSnippet < -1)) {
    throw new TypeError("Invalid robots maxSnippet");
  }
  if (document.jsonLd) {
    if (document.jsonLd.length > 100) throw new RangeError("Too many JSON-LD records");
    for (const node of document.jsonLd) {
      if (!node || typeof node !== "object" || Array.isArray(node)) throw new TypeError("JSON-LD entries require objects");
      const encoded = serializeJsonLd(node as unknown as import("./types.js").StructuredData);
      if (new TextEncoder().encode(encoded).length > 131_072) throw new RangeError("JSON-LD exceeds 128 KiB");
    }
  }
  return {
    ...document, canonical,
    openGraph: document.openGraph ? {
      ...document.openGraph,
      url: document.openGraph.url ? normalizeTarget(document.openGraph.url, policy) : canonical,
      images: [...images.values()]
    } : undefined,
    social: document.social ? {
      ...document.social,
      image: document.social.image ? normalizeTarget(document.social.image, policy) : undefined
    } : undefined,
    alternates: [...alternates.entries()].sort(([a], [b]) => a.localeCompare(b))
      .map(([hreflang, url]) => ({ hreflang, url }))
  };
}
/** Frozen P3 shape: site/layout/route precedence followed by status/visibility safety. */
export async function resolveSeoV1<Data>(
  input: SeoResolveInputV1<Data>, factory: SeoFactoryV1<Data>, options: SeoResolveOptionsV1 = {}
): Promise<SeoResolutionV1> {
  if (input.siteOrigin.protocol !== "https:" || input.siteOrigin.username || input.siteOrigin.password ||
    input.siteOrigin.search || input.siteOrigin.hash) throw new TypeError("Trusted siteOrigin must be HTTPS");
  if (!Number.isInteger(input.status) || input.status < 100 || input.status > 599) throw new RangeError("Invalid HTTP status");
  const redirectStatus = [301, 302, 307, 308].includes(input.status);
  if (redirectStatus !== Boolean(options.redirect) ||
    options.redirect && options.redirect.status !== input.status) {
    throw new TypeError("Redirect status and Location must agree");
  }
  const defaults: SeoDocumentV1 = options.defaults ?? { version: 1 };
  assertVersion(defaults);
  // For auth, missing/deleted pages, redirects and non-200 responses, never call
  // the route metadata factory. Loader data may not exist or may be private.
  if (input.visibility !== "public" || input.status !== 200) {
    const resolution: SeoResolutionV1 = {
      version: 1, status: input.status,
      metadata: {
        version: 1,
        title: input.visibility === "public" && input.status >= 400 ? defaults.title : undefined,
        robots: { index: false, follow: false }
      }
    };
    if (options.redirect) {
      const policy: CanonicalPolicy = {
        siteURL: input.siteOrigin.origin,
        allowedOrigins: options.allowedOrigins,
        trailingSlash: options.trailingSlash,
        query: options.query
      };
      return {
        ...resolution,
        redirect: {
          status: options.redirect.status,
          location: normalizeTarget(options.redirect.location, policy)
        }
      };
    }
    return resolution;
  }

  let document: SeoDocumentV1 = defaults;
  for (const layout of options.layouts ?? []) document = mergeDoc(document, layout);
  const page = await factory(input);
  document = mergeDoc(document, page);
  document = normalizeDoc(document, input, options);
  return { version: 1, status: input.status, metadata: document };
}

export function seoRobotsHeaderV1(document: SeoDocumentV1): string {
  const directives = [
    document.robots?.index === false ? "noindex" : "index",
    document.robots?.follow === false ? "nofollow" : "follow",
    document.robots?.noarchive ? "noarchive" : undefined,
    document.robots?.nosnippet ? "nosnippet" : undefined,
    document.robots?.maxSnippet === undefined ? undefined : "max-snippet:" + document.robots.maxSnippet,
    document.robots?.maxImagePreview ? "max-image-preview:" + document.robots.maxImagePreview : undefined
  ];
  return directives.filter((x): x is string => Boolean(x)).join(", ");
}
/** Data-only structural adapter for Contract 13, without importing SSR. */
export function seoToRenderHeadV1(resolution: SeoResolutionV1): readonly RenderHeadEntryV1[] {
  if (resolution.version !== 1 || resolution.metadata.version !== 1) throw new TypeError("Invalid SEO version");
  const document = resolution.metadata;
  const entries: RenderHeadEntryV1[] = [];
  if (document.title) entries.push({ tag: "title", text: document.title });
  if (document.description) entries.push({ tag: "meta", attributes: { name: "description", content: document.description } });
  if (document.canonical) entries.push({ tag: "link", attributes: { rel: "canonical", href: document.canonical } });
  entries.push({ tag: "meta", attributes: { name: "robots", content: seoRobotsHeaderV1(document) } });
  if (document.openGraph?.title) entries.push({ tag: "meta", attributes: { property: "og:title", content: document.openGraph.title } });
  if (document.openGraph?.description) entries.push({ tag: "meta", attributes: { property: "og:description", content: document.openGraph.description } });
  if (document.openGraph?.type) entries.push({ tag: "meta", attributes: { property: "og:type", content: document.openGraph.type } });
  if (document.openGraph?.url) entries.push({ tag: "meta", attributes: { property: "og:url", content: document.openGraph.url } });
  for (const image of document.openGraph?.images ?? []) {
    entries.push({ tag: "meta", attributes: { property: "og:image", content: image.url } });
    if (image.alt) entries.push({ tag: "meta", attributes: { property: "og:image:alt", content: image.alt } });
  }
  if (document.social?.card) entries.push({ tag: "meta", attributes: { name: "twitter:card", content: document.social.card } });
  if (document.social?.title) entries.push({ tag: "meta", attributes: { name: "twitter:title", content: document.social.title } });
  if (document.social?.description) entries.push({ tag: "meta", attributes: { name: "twitter:description", content: document.social.description } });
  if (document.social?.image) entries.push({ tag: "meta", attributes: { name: "twitter:image", content: document.social.image } });
  for (const alt of document.alternates ?? []) entries.push({ tag: "link",
    attributes: { rel: "alternate", hreflang: alt.hreflang, href: alt.url } });
  if (document.jsonLd?.length) entries.push({ tag: "script-jsonld",
    text: serializeJsonLd(document.jsonLd as unknown as import("./types.js").StructuredDataInput)
  });
  return entries;
}
export interface SeoRouteBindingV1<Data = unknown> {
  readonly routeId: string;
  readonly visibility: "public" | "private" | "draft";
  /** Fixed params for static pages. Do not use these for multi-param dynamic routes. */
  readonly params?: Readonly<Record<string, string>>;
  /** Inject authoritative params from the application Router; SEO does not rematch URLs. */
  readonly resolveParams?: (input: {
    readonly routeId: string;
    readonly url: URL;
    readonly status: number;
    readonly loaderData: unknown;
  }) => Readonly<Record<string, string>>;
  readonly factory: SeoFactoryV1<Data>;
}
/** The application supplies the already matched route's params and loader result. */
export function createSeoHeadAdapterV1(
  config: { readonly siteOrigin: URL; readonly routes: readonly SeoRouteBindingV1[];
    readonly options?: SeoResolveOptionsV1 }
): RenderHeadAdapterV1 {
  const registry = new Map(config.routes.map(route => [route.routeId, route] as const));
  return {
    version: 1,
    async resolve({ routeId, url, status, loaderData }) {
      const route = registry.get(routeId);
      if (!route) throw new TypeError("No SEO factory for route " + routeId);
      const params = route.resolveParams?.({ routeId, url, status, loaderData }) ?? route.params;
      if (!params) throw new TypeError("Missing Router-provided SEO route params");
      const output = await resolveSeoV1({
        routeId, url, status, loaderData, params,
        visibility: route.visibility, siteOrigin: config.siteOrigin
      }, route.factory, config.options);
      return seoToRenderHeadV1(output);
    }
  };
}
export interface SitemapFeedOptionsV1 extends CanonicalPolicy {
  readonly maxPages?: number;
  readonly maxRecords?: number;
  readonly maxEntries?: number;
  readonly maxBytes?: number;
}
export async function generateSitemapsFromFeedV1(
  feed: SitemapFeedV1, signal: AbortSignal, options: SitemapFeedOptionsV1
): Promise<SitemapBuild> {
  if (feed.schema !== "zaakiy.sitemap/1") throw new TypeError("Unsupported sitemap feed schema");
  const feedOrigin = new URL(options.siteURL);
  if (feedOrigin.protocol !== "https:" || feedOrigin.username || feedOrigin.password)
    throw new TypeError("P3 sitemap feed requires a trusted HTTPS origin");
  const maxPages = options.maxPages ?? 1000;
  const maxRecords = options.maxRecords ?? 100_000;
  if (!Number.isSafeInteger(maxPages) || maxPages < 1 || maxPages > 10_000 ||
    !Number.isSafeInteger(maxRecords) || maxRecords < 1 || maxRecords > 1_000_000) {
    throw new RangeError("Invalid feed traversal bounds");
  }
  const entries: SitemapEntry[] = [];
  const cursors = new Set<string>();
  let totalRecords = 0;
  let cursor: string | undefined;
  for (let page = 0; page < maxPages; page++) {
    if (signal.aborted) throw signal.reason ?? new Error("Sitemap generation aborted");
    const result = await feed.entries({ signal, cursor });
    if (signal.aborted) throw signal.reason ?? new Error("Sitemap generation aborted");
    if (!Array.isArray(result.items) || totalRecords + result.items.length > maxRecords)
      throw new RangeError("Sitemap feed exceeds record limit");
    totalRecords += result.items.length;
    for (const entry of result.items) {
      if (entry.visibility !== "public") continue;
      // P3 SitemapEntryV1 requires fully qualified HTTPS page URLs. The lower
      // level static sitemap helper intentionally also accepts relative paths.
      if (!entry.loc.startsWith("https://"))
        throw new TypeError("P3 sitemap feed URL must be absolute HTTPS");
      entries.push({
        loc: entry.loc, lastmod: entry.lastmod,
        changefreq: entry.changefreq, priority: entry.priority,
        alternates: Object.fromEntries((entry.alternates ?? []).map((a: { readonly hreflang: string; readonly url: string }) => [a.hreflang, a.url])),
        published: true, authorized: true
      });
    }
    if (!result.nextCursor) return generateSitemaps(entries, options);
    if (result.nextCursor.length > 1024 || cursors.has(result.nextCursor))
      throw new TypeError("Sitemap feed cursor loop or invalid cursor");
    cursors.add(result.nextCursor);
    cursor = result.nextCursor;
  }
  throw new RangeError("Sitemap feed exceeded page bound");
}
