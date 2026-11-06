# @zaakiyjs/seo

Typed, deterministic SEO metadata, structured-data, robots and sitemap utilities for ZaakiyJS. The server/build-time exports are pure and do not import browser globals, the router, compiler, Node.js, AI or analytics. The browser head adapter is a separate optional entry.

**Provisional:** The P3 SEO/rendering contracts have not been frozen on main as of the initial implementation. Do not merge or publish before contract reconciliation and full quality gates.

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

The async sitemap generator filters entries explicitly labeled draft, private, unauthorized, noindex, redirect, HTTP error or soft 404. It deduplicates and deterministically sorts eligible canonical URLs, emits XML escaping, explicit hreflang alternate links, splits above 50,000 URLs or 50 MB, and creates an index when split. Supply meaningful content lastmod values; the engine never invents build timestamps. Use auditHreflang for reciprocal mapping diagnostics and planSitemapRebuild for incremental record changes.

Input eligibility flags are not a substitute for access control: callers must independently authorize records and must never feed private user data to a public sitemap. Robots.txt and noindex directives are not security boundaries.

Canonical URLs require a configured HTTP(S) origin and reject unsafe schemes, malformed encoding, credentials and untrusted cross-origin overrides. Query strings are preserved unless an explicit strip/allowlist policy is configured. Cross-origin social images need an explicit trusted origin. JSON-LD is serialized with script-context escaping and baseline Schema.org validation; rich-result eligibility is not guaranteed.

## Remaining release gates

The initial implementation is not production-certified until: P3 SEO/SSR contract alignment; workspace verifier allowlist and pnpm frozen-lockfile integration in a separate integration PR; parser-based XML/HTML/browser tests; full lint, strict typecheck, build, tests and independent npm package installation; SSR public adapter review. Never auto-merge this work.

Search Central sources: https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap and https://developers.google.com/search/docs/appearance/structured-data/intro-structured-data and https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics
