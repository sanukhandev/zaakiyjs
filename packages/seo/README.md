# @zaakiyjs/seo

Typed, deterministic SEO metadata, structured-data, robots and sitemap utilities for ZaakiyJS. The server/build-time exports are pure and do not import browser globals, the router, compiler, Node.js, AI or analytics. The browser head adapter is a separate optional entry.

**Contract baseline:** P3-00 was merged as `0f23943a17401170980f66e69e1fd03b2a82a3c3`. This package implements its v1 SEO protocol; publication remains separately gated by approved licensing, namespace ownership, SemVer and release controls.

**Full API and integration guide:** [Complete SEO Usage and Integration Guide](./docs/complete-guide.md) — static metadata, typed route loaders, P3 v1/SSR, SPA head updates, canonical/OG/hreflang, JSON-LD, robots, sitemap feeds, diagnostics, security and deployment examples.

## Usage: static and server metadata

~~~ts
import { defineMetadata, renderMetadata, generateSitemaps } from "@zaakiyjs/seo";
const defaults = defineMetadata({ title: "Catalogue", description: "Product catalogue" });
const result = renderMetadata([
  defaults,
  { title: "Demo", canonical: "/products/demo", structuredData: {
    "@type": "Product", name: "Demo" } }
], { siteURL: "https://example.com", status: 200, trailingSlash: "never" });
console.log(result.html);
console.log(result.headers["X-Robots-Tag"]);
const sitemaps = await generateSitemaps([
  { loc: "/products/demo", published: true, lastmod: "2026-11-01" }
], { siteURL: "https://example.com" });
~~~

Example head output:

~~~html
<title>Demo</title>
<meta name="description" content="Product catalogue">
<link rel="canonical" href="https://example.com/products/demo">
<meta name="robots" content="index, follow">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"Demo"}</script>
~~~

The SSR/SSG host must insert the HTML in the document head and apply the response headers before sending content. SEO is not a server HTML renderer or an alternative router.

## Dynamic authoritative loader data

~~~ts
import { definePageMetadata, resolveRouteMetadata } from "@zaakiyjs/seo";
const product = definePageMetadata<{ name: string; slug: string }>(({ data }) => ({
  title: data.name,
  canonical: "/products/" + encodeURIComponent(data.slug)
}));
const metadata = resolveRouteMetadata("product", [
  { id: "root", metadata: { publisher: "Zaakiy" } },
  { id: "product", parentId: "root", metadata: product }
], { description: "Browse products" }, {
  siteURL: "https://example.com", data: { name: "Demo", slug: "demo" }
});
~~~

Defaults apply before parent layouts, then deeper layouts and the route override. Nested robots, Open Graph, Twitter and language-alternate maps merge by field. A private or HTTP error response always forces noindex and nofollow; the host owns proper 404/410 status and authorization. No network calls occur inside the resolver.

## P3 versioned SEO/SSR protocol

The frozen [P3 SEO contract](../../docs/contracts/14-seo.md) reserves `zaakiy.seo/1` and `zaakiy.sitemap/1`. The package exposes `SeoDocumentV1`, `SeoFactoryV1<Data>`, `SeoResolveInputV1<Data>`, `SeoResolutionV1`, `SitemapFeedV1`, and the data-only `RenderHeadAdapterV1` structural interface. The versioned resolver skips route SEO factories for missing, redirected, private, draft and other non-200 responses.

~~~ts
import { resolveSeoV1, seoToRenderHeadV1, createSeoHeadAdapterV1 } from "@zaakiyjs/seo";

const siteOrigin = new URL("https://shop.example.test");
const productSeo = ({ loaderData }: { loaderData: { title: string } }) => ({
  version: 1 as const,
  title: loaderData.title,
  canonical: "/products/sku-7",
  jsonLd: [{ "@type": "Product", name: loaderData.title }]
});

const resolution = await resolveSeoV1({
  routeId: "product", url: new URL("/products/sku-7", siteOrigin),
  params: { slug: "sku-7" }, loaderData: { title: "Safe Lamp" },
  status: 200, visibility: "public", siteOrigin
}, productSeo);

const headEntries = seoToRenderHeadV1(resolution);
const adapter = createSeoHeadAdapterV1({
  siteOrigin,
  routes: [{ routeId: "product", visibility: "public",
    params: { slug: "sku-7" }, factory: productSeo }]
});
~~~

The host/SSR integration must consume `headEntries` as **structured data**, apply its own safe head serialization and CSP, and preserve authoritative HTTP status and redirects. The SEO package never renders server HTML, imports SSR/Router internals, or reruns loaders. 3xx requires an explicitly approved redirect; 404/410/private/draft output omits canonical and JSON-LD and forces noindex. Schema/metadata audit consumers use `auditSeoV1`.

For paginated published content, `generateSitemapsFromFeedV1(feed, signal, options)` requires the `zaakiy.sitemap/1` schema; it traverses bounded cursors with an `AbortSignal`, then reuses deterministic sitemap serialization. The feed implementation is responsible for returning only authorized public records and correct meaningful `lastmod` fields.

## SPA navigation

~~~ts
import { createHeadManager } from "@zaakiyjs/seo/browser";
import { renderMetadata } from "@zaakiyjs/seo";
const lifetime = new AbortController();
const head = createHeadManager(document, lifetime.signal);
head.update(renderMetadata({ title: "Page", canonical: "/a" }, {
  siteURL: "https://example.com"
}), { version: 1 });
lifetime.abort();
~~~

Call update only after successful navigation with a monotonically increasing version and optional pending navigation AbortSignal; stale/aborted updates do not apply. Manager disposal removes the managed metadata. Public indexable pages should preferably pre-render metadata, not depend on JavaScript-only head changes.

## Sitemap, localization and crawler policies

The async sitemap generator filters entries explicitly labeled draft, private, unauthorized, noindex, redirect, HTTP error or soft 404. It excludes non-200 status responses, deduplicates identical canonical records, **rejects conflicting duplicate canonical metadata**, and sorts eligible URLs deterministically. It rejects invalid calendar dates and sitemap page URLs of 2,048 or more characters, enforces a bounded total source-record count (default 100,000), emits XML escaping and explicit hreflang alternate links, splits at 50,000 URLs or 50 MB per sitemap, and creates an index when split. Supply meaningful content lastmod values; the engine never invents build timestamps. Use auditHreflang for reciprocal mapping diagnostics and planSitemapRebuild for incremental record changes.

Input eligibility flags are not a substitute for access control: callers must independently authorize records and must never feed private user data to a public sitemap. Robots.txt and noindex directives are not security boundaries.

Canonical URLs require a configured HTTP(S) origin and reject unsafe schemes, malformed encoding, credentials and untrusted cross-origin overrides. Query strings are preserved unless an explicit strip/allowlist policy is configured. Cross-origin social images need an explicit trusted origin. JSON-LD is serialized with script-context escaping and baseline Schema.org validation; rich-result eligibility is not guaranteed.

## Remaining release gates

P3 contract and workspace integration are now incorporated, and parser-based HTML/XML tests are included. The last merged-branch quality gate must pass before approving the implementation PR. Future SSR end-to-end adapter acceptance requires a real SSR implementation and is not claimed complete by the SEO package tests. Independent npm publication remains blocked until license approval, SemVer release decision, npm scope ownership verification and publish authorization. Do not automatically merge or publish.

Search Central sources: https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap and https://developers.google.com/search/docs/appearance/structured-data/intro-structured-data and https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics
