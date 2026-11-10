# @zaakiyjs/seo — Complete Usage and Integration Guide

> **Implementation reference:** the `packages/seo/src` public exports and tests on the SEO feature branch. **Package version:** `0.0.0` (unreleased). **Protocol contracts:** `zaakiy.seo/1` and `zaakiy.sitemap/1`. This guide describes implemented behavior, not a published npm release or a promise of search-engine indexing.
>
> **Start here:** [package README](../README.md) · [frozen SEO contract](../../../docs/contracts/14-seo.md) · [rendering architecture](../../../docs/architecture/rendering-and-seo.md) · [engineering policy](../../../AGENTS.md).

## Contents

1. [Scope, imports and installation](#1-scope-imports-and-installation)
2. [Quick start: static HTML head](#2-quick-start-static-html-head)
3. [Complete legacy/unversioned metadata API](#3-complete-legacyunversioned-metadata-api)
4. [Dynamic route and layout metadata](#4-dynamic-route-and-layout-metadata)
5. [Canonical URLs, social previews and hreflang](#5-canonical-urls-social-previews-and-hreflang)
6. [JSON-LD structured data and serialization](#6-json-ld-structured-data-and-serialization)
7. [Robots directives and robots.txt](#7-robots-directives-and-robotstxt)
8. [Versioned SEO v1 protocol and redirects](#8-versioned-seo-v1-protocol-and-redirects)
9. [SSR/SSG head adapter](#9-ssrssg-head-adapter)
10. [Browser/SPA head management](#10-browserspa-head-management)
11. [Static and streaming sitemap generation](#11-static-and-streaming-sitemap-generation)
12. [Paginated sitemap feed protocol](#12-paginated-sitemap-feed-protocol)
13. [Auditing and diagnostic codes](#13-auditing-and-diagnostic-codes)
14. [Security, privacy, correctness and limits](#14-security-privacy-correctness-and-limits)
15. [Testing, deployment and troubleshooting](#15-testing-deployment-and-troubleshooting)
16. [Public API inventory and compatibility](#16-public-api-inventory-and-compatibility)

## 1. Scope, imports and installation

`@zaakiyjs/seo` provides **pure, deterministic** metadata resolution, safe HTML-head serialization, canonical URL validation, structured data, robots rules, sitemap generation, locale alternates and diagnostics. An **opt-in browser entry** updates `document.head` on SPA navigation.

It **does not** implement a router, route matcher, loader, authorization system, server HTTP responder, SSR HTML renderer, cache invalidation service, analytics, ads, consent manager, search submission or search indexing. The host application remains authoritative for HTTP status, `Location` redirects, CSP, permissions, and published/public record selection.

At this branch revision, the package has **no mandatory runtime package dependencies**, and npm publication remains blocked. Inside the monorepo use the workspace package; after independent publication is authorized, the planned consumer import is identical:

```ts
import {
  defineMetadata,
  definePageMetadata,
  resolveMetadata,
  resolveRouteMetadata,
  renderMetadata,
  generateSitemaps
} from "@zaakiyjs/seo";

// Only for browser code; does not run as part of the universal import:
import { createHeadManager } from "@zaakiyjs/seo/browser";
```

For a local workspace consumer, configure `"@zaakiyjs/seo": "workspace:^"` in the consuming package and use a frozen workspace install. **Do not assume `npm install @zaakiyjs/seo` succeeds** until the first release is explicitly approved and published. TypeScript/ESM uses the `"."` and `"./browser"` exports declared in `packages/seo/package.json`; private `src` module imports are not public APIs. Only `dist`, `README.md` and `CHANGELOG.md` are currently included in the npm tarball, so this source guide is not itself packaged.

### Choose the right API

| Application need | Recommended surface | Important distinction |
|---|---|---|
| Simple static page or existing head HTML | `renderMetadata` | Returns resolved data, typed tags, escaped HTML string and `X-Robots-Tag` header value |
| Defaults / parent-layout / typed loader metadata | `definePageMetadata` + `resolveRouteMetadata` | Synchronous, using unversioned `Metadata` and `data` |
| Frozen P3 typed contract / async loader SEO | `resolveSeoV1` | Async, uses `SeoDocumentV1` and `loaderData` |
| Structural integration with an SSR renderer | `seoToRenderHeadV1` or `createSeoHeadAdapterV1` | Returns data entries, **not HTML strings** |
| Navigate a JavaScript SPA | `createHeadManager` from `/browser` | Accepts the **unversioned** `RenderedMetadata` result |
| Publish sitemaps | `generateSitemaps` / `generateSitemapsFromFeedV1` | Feed v1 requires absolute HTTPS entries; static helper can accept relative paths |
| Inspect indexability and consistency | `auditMetadata` / `auditSeoV1` / `auditHreflang` | Reports structured diagnostics; does not repair pages automatically |

**Avoid mixing models:** unversioned `Metadata.structuredData` maps to Schema.org JSON-LD, `Metadata.twitter` maps to Twitter tags and `Metadata.openGraph.image` is one string. V1 uses `SeoDocumentV1.jsonLd`, `social` and `openGraph.images[]` respectively. They are **not** aliases or directly interchangeable structures.

## 2. Quick start: static HTML head

```ts
import { defineMetadata, renderMetadata } from "@zaakiyjs/seo";

const defaults = defineMetadata({
  title: "Acme Store",
  description: "Hand-selected furniture and home accessories.",
  openGraph: { siteName: "Acme Store" }
});

const page = renderMetadata(
  [
    defaults,
    {
      title: "Desk Lamp — Acme Store",
      canonical: "/products/desk-lamp",
      openGraph: {
        title: "Desk Lamp",
        image: "/images/desk-lamp.png",
        type: "product"
      },
      twitter: { card: "summary_large_image" },
      structuredData: {
        "@type": "Product",
        name: "Desk Lamp"
      }
    }
  ],
  {
    siteURL: "https://shop.example.test",
    status: 200,
    trailingSlash: "never"
  }
);

// Metadata resolved to absolute URLs:
console.log(page.metadata.canonical);
// https://shop.example.test/products/desk-lamp

// Escaped, validated <title>, <meta>, <link>, and JSON-LD head markup:
console.log(page.html);

// Important: apply this header in the real HTTP response on the server:
console.log(page.headers["X-Robots-Tag"]);
// index, follow
```

The host's SSR/SSG template may insert `page.html` into the HTML `<head>` **only after using this trusted built-in serializer**. It must also apply `page.headers` to the *actual HTTP response* and return a truthful `200`, `404`, `410` or redirect status. This helper does not respond to HTTP requests or replace server-side authorization.

For private/errored pages, pass accurate status and privacy flags **before** metadata is evaluated:

```ts
const missing = renderMetadata(
  ({ data }: { data: { title: string } }) => ({
    title: data.title, canonical: "/missing"
  }),
  { siteURL: "https://shop.example.test", status: 404 }
);
// Safe even with no loader data: factory is NOT invoked.
// missing.metadata.robots = { index: false, follow: false }
// missing.html has a robots noindex tag; no product canonical or JSON-LD.
```

## 3. Complete legacy/unversioned metadata API

### Type fields

`Metadata` accepts:

| Field | Type / effect |
|---|---|
| `title` | String; one escaped `<title>` |
| `description` | String; `meta[name=description]` |
| `canonical` | Relative/absolute string, validated and normalized to an allowed site origin |
| `robots` | `{ index?, follow?, noarchive?, nosnippet?, noimageindex? }` |
| `openGraph` | `{ title?, description?, image?, type?, siteName? }`; emits OG meta tags |
| `twitter` | `{ card?: "summary" \| "summary_large_image", title?, description?, image?, site?, creator? }` |
| `author` / `publisher` | Author/publisher meta tags |
| `locale` | Optional document locale stored in metadata; not an automatic HTML `lang` setter |
| `alternates` | `Record<string, string>`, e.g. `{ en: "/en", fr: "/fr", "x-default": "/" }` |
| `structuredData` | Schema.org-shaped `StructuredData` object or array, serialized into one JSON-LD script |

`defineMetadata(value)` is a typed identity helper; `definePageMetadata<Data, Params>(definition)` is an identity helper for either static metadata or a factory receiving `{ data, params, locale?, status? }`.

`resolveMetadata(layers, options)` returns `ResolvedMetadata`. It evaluates layers **from first to last** (site defaults, layouts, page). Top-level fields use later values. `robots`, `openGraph`, `twitter` and `alternates` merge **shallowly by nested key**. The `structuredData` field is replaced by the last layer that supplies it (not appended automatically). `robots.index` and `robots.follow` default to `true`, unless explicitly disabled or response safety overrides them.

`metadataToTags(resolved)` creates typed, deterministic `HeadTag[]`; `serializeHeadTags(tags)` validates tag kinds, attributes, links, duplicate keys and JSON-LD before returning escaped HTML. `renderMetadata(definitionOrLayers, options)` combines resolution, tags, serialization and `X-Robots-Tag` in one `RenderedMetadata` object.

```ts
import {
  defineMetadata, resolveMetadata, metadataToTags,
  serializeHeadTags, robotsContent
} from "@zaakiyjs/seo";

const resolved = resolveMetadata([
  defineMetadata({ title: "Site", robots: { follow: false } }),
  { title: "Article", robots: { index: true }, canonical: "/article" }
], { siteURL: "https://example.test", status: 200 });

const tags = metadataToTags(resolved);
const html = serializeHeadTags(tags);
const header = robotsContent(resolved.robots);
// "index, nofollow"
```

`ResolvedMetadata` contains the normalized canonical, normalized OG/Twitter image URLs, normalized/sorted alternates and explicit robots index/follow defaults. `RenderedMetadata` has four properties: `metadata`, `tags`, `html`, `headers`.

**Failure mode:** if `options.private === true` or `options.status` is supplied and differs from `200`, no metadata layers or factories execute. Output is fail-closed `{ robots: { index: false, follow: false }, locale }`; previous page titles, canonical links, OG metadata, Twitter metadata and structured data are not carried through.

## 4. Dynamic route and layout metadata

Use data **already authorized and loaded** by the real application router. This API performs no loading itself.

```ts
import { definePageMetadata, resolveRouteMetadata } from "@zaakiyjs/seo";

type Product = { name: string; summary: string };
type Params = { slug: string };

const productSeo = definePageMetadata<Product, Params>(({ data, params }) => ({
  title: data.name + " | Acme Store",
  description: data.summary,
  canonical: "/products/" + encodeURIComponent(params.slug),
  openGraph: { type: "product", title: data.name }
}));

const resolved = resolveRouteMetadata<Product, Params>(
  "product",
  [
    { id: "root", metadata: { publisher: "Acme Store" } },
    { id: "catalog", parentId: "root",
      metadata: { description: "Explore the catalogue." } },
    { id: "product", parentId: "catalog", metadata: productSeo }
  ],
  { title: "Acme Store", robots: { index: true } },
  {
    siteURL: "https://shop.example.test",
    status: 200,
    data: { name: "Desk Lamp", summary: "A compact warm light." },
    params: { slug: "desk lamp" },
    locale: "en"
  }
);
// canonical = https://shop.example.test/products/desk%20lamp
```

`RouteSeoConfig` fields: `id` (required), `parentId?` and `metadata?`. The function resolves the named route's lineage in order: **defaults → root → parent layouts → route**. Unknown IDs and circular parent chains throw. You can pass the resulting `ResolvedMetadata` to `metadataToTags` or pass matching layers directly to `renderMetadata`.

Never run a loader-dependent SEO factory on unauthorized data. Use `status`/`private` to prevent execution on denied, redirected, deleted or missing pages.

## 5. Canonical URLs, social previews and hreflang

### `normalizeCanonical(input, policy)`

`CanonicalPolicy` has:

- `siteURL: string` — trusted HTTP(S) site origin or base path with **no** username, password, query or fragment.
- `trailingSlash?: "always" | "never" | "preserve"`.
- `query?: "preserve" | "strip" | { allow: string[] }`; default preserves query.
- `allowedOrigins?: string[]` — *explicitly trusted* cross-origin destination origins. Prefer HTTPS production origins.

```ts
import { normalizeCanonical } from "@zaakiyjs/seo";

const policy = { siteURL: "https://shop.example.test" };
normalizeCanonical("/catalog?page=2#section", policy);
// https://shop.example.test/catalog?page=2
normalizeCanonical("/catalog?utm_source=ad&page=2", {
  ...policy, query: { allow: ["page"] }
});
// https://shop.example.test/catalog?page=2
normalizeCanonical("/products/lamp/", {
  ...policy, trailingSlash: "never", query: "strip"
});
// https://shop.example.test/products/lamp
normalizeCanonical("https://assets.example.test/preview.png", {
  ...policy, allowedOrigins: ["https://assets.example.test"]
});
```

Canonical normalization rejects protocol-relative URLs (`//other.test`), JavaScript/data schemes, unapproved cross-origin URLs, credentials, control characters, backslashes and malformed URL percent-encoding. Fragments are removed from canonical URLs; repeated slashes in paths are normalized. **Do not strip meaningful pagination or language parameters without a deliberate canonical strategy.**

Open Graph and Twitter URLs in **unversioned** metadata share this normalization policy. For alternate-language head links:

```ts
import { renderMetadata } from "@zaakiyjs/seo";

const localized = renderMetadata({
  title: "Lamp",
  canonical: "/en/lamp",
  alternates: {
    en: "/en/lamp",
    fr: "/fr/lampe",
    "x-default": "/"
  },
  openGraph: {
    title: "Lamp",
    description: "Warm desk lamp",
    image: "/images/lamp.jpg",
    type: "product",
    siteName: "Acme Store"
  },
  twitter: {
    card: "summary_large_image",
    title: "Lamp",
    image: "/images/lamp.jpg"
  }
}, { siteURL: "https://shop.example.test" });
console.log(localized.html);
```

All localized pages should agree on reciprocal alternate maps; `auditHreflang` can diagnose missing reciprocity for pages included in its input. The renderer does not set the HTML document's `lang` attribute automatically.

## 6. JSON-LD structured data and serialization

`defineStructuredData(value)` validates and returns the supplied object. `validateStructuredData(input)` throws on invalid input. `serializeJsonLd(input)` validates and returns safe JSON text suitable for an `application/ld+json` script.

```ts
import {
  defineStructuredData, validateStructuredData, serializeJsonLd,
  renderMetadata
} from "@zaakiyjs/seo";

const product = defineStructuredData({
  "@type": "Product",
  name: "Desk Lamp",
  description: "A compact desk lamp.",
  offers: { "@type": "Offer", price: "49.00", priceCurrency: "USD" }
});
validateStructuredData(product);
const jsonText = serializeJsonLd(product);
// Safe script-context JSON (not an executable JS snippet).

const rendered = renderMetadata(
  { title: "Desk Lamp", canonical: "/lamp", structuredData: product },
  { siteURL: "https://shop.example.test" }
);
console.log(rendered.html);
```

Known baseline-required fields:

| `@type` | Required fields |
|---|---|
| `Organization` | `name` |
| `WebSite` | `name`, `url` |
| `WebPage` | `name` |
| `BreadcrumbList` | `itemListElement` |
| `Article` | `headline` |
| `Product` | `name` |
| `FAQPage` | `mainEntity` |
| `LocalBusiness` | `name` |
| `SoftwareApplication` | `name`, `applicationCategory` |

For any type, nonempty `@type` is required. When provided, `@context` must be exactly `https://schema.org`; the serializer injects this context for top-level entries that omit it. Disallowed: functions, symbols, bigint, undefined, NaN/Infinity, cycles, object keys `__proto__`/`constructor`/`prototype`, and tree depth above 30. `serializeJsonLd` escapes `<`, `>`, `&` and Unicode line/paragraph separators to prevent script-context breakouts. Arrays are supported.

**Limitations:** this is baseline schema validation, not a full JSON Schema validator, rich-results validator, content verifier, or proof of Google eligibility. Only emit structured data describing the actual publicly visible page. In the v1 resolver, `jsonLd` accepts up to **100** records and each serialized record is capped at **128 KiB**.

HTML utility functions `escapeHtml` and `escapeXml` escape `&`, `<`, `>`, quotation marks and apostrophes; use built-in serializers instead of hand-concatenating unsanitized input.

## 7. Robots directives and robots.txt

### Page-level robots

```ts
import { renderMetadata, robotsContent } from "@zaakiyjs/seo";

const page = renderMetadata({
  title: "Archived post",
  canonical: "/archive/post-1",
  robots: {
    index: false,
    follow: false,
    noarchive: true,
    nosnippet: true,
    noimageindex: true
  }
}, { siteURL: "https://example.test", status: 200 });

console.log(page.headers["X-Robots-Tag"]);
// noindex, nofollow, noarchive, nosnippet, noimageindex
console.log(robotsContent(page.metadata.robots));
```

For **v1** `SeoDocumentV1.robots`, additional `maxSnippet` (integer ≥ -1) and `maxImagePreview` (`none`/`standard`/`large`) are supported by `seoRobotsHeaderV1`. Those fields are **not** part of the unversioned `RobotsDirectives` type.

### `generateRobotsTxt`

```ts
import { generateRobotsTxt } from "@zaakiyjs/seo";

const text = generateRobotsTxt({
  siteURL: "https://shop.example.test",
  groups: [
    { agents: ["*"], allow: ["/"], disallow: ["/private", "/account"] },
    { agents: ["ExampleBot"], disallow: ["/temporary"] }
  ],
  sitemaps: ["/sitemap.xml", "/catalog-sitemap.xml"]
});
// Serve as text/plain at the site's /robots.txt path.
```

`RobotsTxtOptions` extends `CanonicalPolicy` and accepts `groups?: RobotsGroup[]` and `sitemaps?: string[]`. Each `RobotsGroup` requires ≥1 user agent and optional `allow`/`disallow` lists of leading-`/` paths. Input tokens reject control characters; sitemap URLs are normalized. If `groups` is omitted, the output includes a `User-agent: *` group. This does **not** authenticate users, hide content, or force search crawlers to obey directives.

## 8. Versioned SEO v1 protocol and redirects

Use this contract for authoritative public pages, async metadata factories and a structural SSR head integration. The **v1** input and document fields are explicitly versioned.

```ts
import {
  resolveSeoV1, seoRobotsHeaderV1, seoToRenderHeadV1
} from "@zaakiyjs/seo";
import type { SeoDocumentV1, SeoResolveInputV1 } from "@zaakiyjs/seo";

type Product = { name: string; summary: string; image: string };

const siteOrigin = new URL("https://shop.example.test");
const input: SeoResolveInputV1<Product> = {
  routeId: "product",
  url: new URL("https://shop.example.test/products/lamp"),
  params: { slug: "lamp" },
  loaderData: { name: "Desk Lamp", summary: "Compact and bright.", image: "/lamp.png" },
  status: 200,
  visibility: "public",
  siteOrigin
};

const resolution = await resolveSeoV1(input, ({ loaderData, params }): SeoDocumentV1 => ({
  version: 1,
  title: loaderData.name,
  description: loaderData.summary,
  canonical: "/products/" + encodeURIComponent(params.slug),
  robots: { index: true, follow: true, maxImagePreview: "large" },
  openGraph: {
    type: "product",
    title: loaderData.name,
    images: [{ url: loaderData.image, alt: loaderData.name, width: 1200, height: 630 }]
  },
  social: { card: "summary_large_image", title: loaderData.name, image: loaderData.image },
  locale: "en-US",
  alternates: [{ hreflang: "en", url: "/products/lamp" }],
  jsonLd: [{ "@type": "Product", name: loaderData.name }]
}), {
  defaults: { version: 1, description: "Acme Store catalogue" },
  layouts: [{ version: 1, openGraph: { siteName: "Acme Store" } }],
  trailingSlash: "never"
});

console.log(resolution.status);       // 200, as supplied by the host
console.log(resolution.metadata.canonical);
console.log(seoRobotsHeaderV1(resolution.metadata));
const headEntries = seoToRenderHeadV1(resolution); // typed head entry data, not HTML
```

### V1 types and resolution precedence

- `SeoResolveInputV1<Data>`: `routeId`, request `url`, typed `params`, completed/authorized `loaderData`, authoritative numeric `status` (100–599), `visibility` (`public`/`private`/`draft`), trusted HTTPS `siteOrigin`.
- `SeoFactoryV1<Data>`: receives that input; returns `SeoDocumentV1` synchronously or asynchronously.
- `SeoResolveOptionsV1`: optional `defaults`, ordered `layouts`, `allowedOrigins`, `trailingSlash`, `query` and optional validated `redirect`.
- `SeoResolutionV1`: `{ version: 1, status, metadata, redirect? }`.
- `SeoDocumentV1`: `version: 1` plus title, description, canonical, robots, `openGraph` (`type`, title, description, url, siteName, **images[]**), `social` (card, title, description, image, imageAlt), locale, **alternates[]**, **jsonLd[]**.

Merge order is **defaults → each layout → route factory**. Nested robots/OG/social objects merge by field. V1 alternates and JSON-LD **replace** prior arrays when supplied by a later layer. Canonical defaults to the current request path and query if omitted; HTTPS and destination policy are enforced; OG images deduplicate by normalized URL (first occurrence kept). Hreflang labels are validated as BCP 47 / `x-default` and normalized; conflicting duplicate labels throw. Invalid OG image dimensions (non-positive/non-integer), unsafe URLs and bad protocol versions throw.

### Safety for private, missing and redirected routes

For any `visibility !== "public"` or `status !== 200`, **the SEO factory is not called**. Metadata is forced to `noindex, nofollow`, without canonical, social preview or JSON-LD. A safe default title can be retained for a public error status ≥400; private/draft routes do not inherit it. The host must still return real `401`/`403`/`404`/`410`/`5xx` and enforce permissions.

A redirect requires an explicit matching `status` and `redirect` option. Only `301`, `302`, `307` and `308` are supported for validated redirects:

```ts
const redirect = await resolveSeoV1(
  {
    ...input,
    status: 302
  },
  () => { throw new Error("The factory must not run for redirects"); },
  {
    query: "strip",
    trailingSlash: "never",
    redirect: { status: 302, location: "/new/?item=7#details" }
  }
);
console.log(redirect.redirect?.location);
// https://shop.example.test/new/?item=7#details
// The HTTP host must set status 302 and Location to this validated value.
```

Redirect validation enforces an approved HTTPS destination and preserves the **exact redirect query, fragment and trailing slash** independently of canonical query/slash policy. Query-only relative targets resolve against the actual request URL. Disallow untrusted `//` origins, credentials, malformed percent-encoding and unsupported schemes. Do not issue a meta refresh as a substitute for an HTTP redirect.

## 9. SSR/SSG head adapter

`seoToRenderHeadV1(resolution)` returns `RenderHeadEntryV1[]`. Each entry has `tag: "title" | "meta" | "link" | "script-jsonld"` and optional `attributes`/`text`. This matches the **structural** `RenderHeadAdapterV1` contract without an import from `@zaakiyjs/ssr`.

```ts
import { createSeoHeadAdapterV1 } from "@zaakiyjs/seo";

const adapter = createSeoHeadAdapterV1({
  siteOrigin: new URL("https://shop.example.test"),
  routes: [{
    routeId: "about",
    visibility: "public",
    params: {}, // valid fixed params for a static page
    factory: () => ({
      version: 1,
      title: "About us",
      canonical: "/about",
      openGraph: { type: "website", title: "About us" }
    })
  }]
});

// Call only after the real Router has selected the route and completed its loader:
const entries = await adapter.resolve({
  routeId: "about",
  url: new URL("https://shop.example.test/about"),
  status: 200,
  loaderData: undefined
});
// Pass entries to the host's safe, CSP-compliant SSR head serializer.
```

`SeoRouteBindingV1` fields are `routeId`, `visibility`, `factory` and either fixed `params` or application-provided `resolveParams(input)`. **Fixed params are only for static pages**. For dynamic routes, use `resolveParams` to inject the application's already-matched route params. This adapter does **not** run route matching, guards or loaders; do not share per-user route data in process-global maps. Unknown routes or absent params throw.

Use `resolveSeoV1` directly when request-scoped route parameters and loader data are available; it avoids re-matching paths. The host must sanitize/serialize `RenderHeadEntryV1`, set CSP and response headers, and apply the authoritative HTTP status/redirect. **Do not** treat the data-only adapter as an HTML renderer or call `serializeHeadTags` on v1 entries (they are a different type). Treat raw JSON-LD as data and use a secure final script serializer.

For SSG, call the resolver with known public records during the build; persist only public HTML/head output. For SSR, resolve within the request's authorization scope and never cache user-specific results globally. Incremental regeneration, cache invalidation, SSR hydration and framework route binding are **outside this package**.

## 10. Browser/SPA head management

The `@zaakiyjs/seo/browser` entry exports `createHeadManager(doc, lifetime?)` and the `HeadManager` interface. It only accepts **unversioned `RenderedMetadata`** from `renderMetadata`.

```ts
import { createHeadManager } from "@zaakiyjs/seo/browser";
import { renderMetadata } from "@zaakiyjs/seo";

const owner = new AbortController();
const manager = createHeadManager(document, owner.signal);

const latest = renderMetadata({
  title: "Catalogue", canonical: "/catalogue",
  description: "Shop the catalogue"
}, { siteURL: "https://shop.example.test", status: 200 });

manager.update(latest, { version: 4 }); // true
manager.update(latest, { version: 3 }); // false: stale navigation

const navigation = new AbortController();
navigation.abort();
manager.update(latest, { version: 5, signal: navigation.signal }); // false

const privatePage = renderMetadata({ title: "Secret" }, {
  siteURL: "https://shop.example.test",
  private: true
});
manager.update(privatePage, { version: 6 });
// Removes obsolete canonical, social, alternates and JSON-LD SEO tags.

owner.abort(); // disposes manager, removes managed SEO elements/listener
```

**Update semantics:**

- `update(result, {version?, signal?})` returns `false` after lifetime disposal, when the navigation signal is already aborted, or if the supplied version is stale/equal to the last applied version.
- Versions must be nonnegative safe integers; omitted versions increment automatically. Use a **monotonically increasing navigation revision** for async route changes.
- The implementation validates all tags *before mutating the DOM*, adopts relevant existing server-rendered title/meta/canonical/hreflang/JSON-LD on first committed navigation, removes stale SEO nodes and duplicate canonicals, and preserves unrelated charset/viewport/styles.
- `dispose()` is idempotent and removes owned SEO nodes; it does **not** tear down the router or cancel external loaders. `lifetime` abort triggers the same disposal.
- This entry changes only document-head DOM; it does **not** provide an `X-Robots-Tag` network header or actual 404/redirect status. **Prefer server-rendered/public metadata** for indexable pages; never rely solely on SPA DOM updates for authorization or crawler behavior.

## 11. Static and streaming sitemap generation

`generateSitemaps(source, options)` accepts `Iterable<SitemapEntry>` or `AsyncIterable<SitemapEntry>` and returns a `Promise<SitemapBuild>`. Source entries can use relative URLs (resolved against `siteURL`); v1 feeds have stricter requirements.

```ts
import {
  generateSitemaps, generateSitemapIndex, planSitemapRebuild, auditHreflang
} from "@zaakiyjs/seo";

const build = await generateSitemaps([
  {
    loc: "/products/lamp",
    published: true, authorized: true, status: 200,
    lastmod: "2026-11-01",
    changefreq: "weekly",
    priority: 0.8,
    alternates: { en: "/en/products/lamp", fr: "/fr/produits/lampe" }
  },
  { loc: "/products/draft", published: false },
  { loc: "/account", private: true },
  { loc: "/removed", status: 410 }
], {
  siteURL: "https://shop.example.test",
  prefix: "catalogue",
  maxEntries: 50_000,
  maxBytes: 50_000_000,
  maxRecords: 100_000
});

for (const file of build.files) {
  console.log(file.filename, file.count, file.xml, file.urls);
  // Deploy each XML file as a public static asset.
}
console.log(build.index);    // undefined unless splitting created >1 file
console.log(build.excluded); // excluded records, including exact duplicates
```

`SitemapEntry` fields: `loc` (required), `lastmod?: string | Date`, `changefreq?`, `priority?` (0–1), `alternates?: Record<string, string>`, and eligibility markers `published?`, `private?`, `authorized?`, `noindex?`, `status?`, `redirect?`, `soft404?`.

**Critical eligibility caveat:** the helper excludes entries when `published === false`, `authorized === false`, `private === true`, `noindex === true`, `redirect === true`, `soft404 === true`, or supplied `status !== 200`. **Omitted flags are not proof of authorization or publication**: the caller must query/authorize/filter only public published content. In particular, `robots.txt`, SEO `noindex` and this helper are not access-control mechanisms.

Deterministic behavior:

- Normalize URLs and alternates, XML-escape output and sort pages by canonical URL.
- Exact duplicate canonical entries are excluded; duplicate canonicals with **conflicting XML metadata throw**.
- `lastmod` is emitted only if explicitly supplied (ISO date/time or valid `Date`); impossible calendar dates, including non-leap February 29, are rejected. Do not manufacture timestamps from build time.
- Split by **at most 50,000 URLs** and **50,000,000 encoded bytes** per file; each URL must contain fewer than **2,048 characters**. A single oversized entry throws.
- Default `maxRecords` is **100,000**, counts all source records *including excluded ones*, and accepts a configured bound up to **1,000,000**. `maxEntries` must be 1–50,000; `maxBytes` must be 1,024–50,000,000.
- Default file prefix `sitemap` permits only ASCII letters, digits, underscore and hyphen. A single-file build emits `sitemap.xml` (or your prefix). Split builds emit numbered files plus `build.index` (the XML index body).
- An empty input still returns one valid, empty sitemap file. `build.excluded` includes ineligible and exact duplicate records.
- Output is XML text/data; **the application must write, cache, deploy and serve** it at the chosen paths.

### Async records / streaming source

```ts
async function* publicProductPages() {
  // The real repository query must enforce published/public/authorized constraints.
  yield { loc: "/a", published: true, authorized: true, status: 200 };
  yield { loc: "/b", lastmod: "2026-11-01", published: true, authorized: true, status: 200 };
}
const batch = await generateSitemaps(publicProductPages(), {
  siteURL: "https://shop.example.test",
  maxRecords: 20_000
});
```

### Manual index and incremental rebuild plan

```ts
const indexXml = generateSitemapIndex([
  { loc: "/catalogue-1.xml", lastmod: "2026-11-01" },
  { loc: "/catalogue-2.xml" }
], { siteURL: "https://shop.example.test" });
// Sorts by URL, rejects duplicate locations and >50,000 entries,
// enforces 50 MB total index size.

const diff = planSitemapRebuild(
  { "product:a": "etag-old", "product:b": "unchanged" },
  { "product:a": "etag-new", "product:b": "unchanged", "product:c": "initial" }
);
// { changed: ["product:a", "product:c"], removed: [] }
```

`planSitemapRebuild` compares keyed source revision/hash maps and returns sorted `changed`/`removed` ID arrays; it **does not rebuild or deploy files**. Treat those revision values as trustworthy content versions.

### Reciprocal hreflang audit

```ts
const localeIssues = auditHreflang([
  { loc: "/en", alternates: { en: "/en", fr: "/fr" } },
  { loc: "/fr", alternates: { en: "/en", fr: "/fr" } }
], { siteURL: "https://shop.example.test" });
console.log(localeIssues); // no reciprocal-link warnings for this example
```

The audit checks format and whether an alternate destination **included in the supplied page set** points back to the source. It cannot validate pages not passed to it or guarantee search-engine interpretation.

## 12. Paginated sitemap feed protocol

`SitemapFeedV1` uses `schema: "zaakiy.sitemap/1"` and `entries({ signal, cursor? }) => Promise<{ items, nextCursor? }>`. Every `SitemapEntryV1` must have `visibility: "public"` and an **absolute HTTPS `loc`**. Use this form for bounded CMS/catalog discovery.

```ts
import { generateSitemapsFromFeedV1 } from "@zaakiyjs/seo";
import type { SitemapFeedV1 } from "@zaakiyjs/seo";

const feed: SitemapFeedV1 = {
  schema: "zaakiy.sitemap/1",
  async entries({ signal, cursor }) {
    signal.throwIfAborted();
    // Real code: fetch ONLY authorized, published, canonical records
    // from your server-side content repository; never expose private rows.
    if (!cursor) {
      return {
        items: [{
          loc: "https://shop.example.test/products/lamp",
          visibility: "public",
          lastmod: "2026-11-01"
        }],
        nextCursor: "next-page"
      };
    }
    return { items: [{
      loc: "https://shop.example.test/products/chair",
      visibility: "public"
    }] };
  }
};

const cancellation = new AbortController();
const build = await generateSitemapsFromFeedV1(feed, cancellation.signal, {
  siteURL: "https://shop.example.test",
  maxPages: 100,
  maxRecords: 20_000,
  maxEntries: 50_000
});
```

The implementation checks the signal before/after each awaited page, detects repeated/oversized cursors (length >1,024), and stops after a bounded number of pages and records. Defaults: `maxPages = 1,000`, `maxRecords = 100,000`. Hard upper bounds: `maxPages ≤ 10,000` and `maxRecords ≤ 1,000,000`. Invalid schema, insecure origin, relative/non-HTTPS entry URLs, cursor loops and overflow throw. The result is passed to the static deterministic sitemap generator.

The feed protocol's `visibility: "public"` is a **declaration by a trusted feed**, not a security check. Ensure server-side repository filtering and tenant isolation *before* emitting feed items.

## 13. Auditing and diagnostic codes

Both audit families return `readonly SeoDiagnostic[]` with `{ code, severity: "error" | "warning" | "info", message, path? }`. They **report** defects; they do not throw for ordinary audit findings or automatically edit metadata.

```ts
import { auditMetadata, auditSeoV1 } from "@zaakiyjs/seo";

const simple = renderMetadata(
  { title: "Home", canonical: "/" },
  { siteURL: "https://example.test" }
);
const basicIssues = auditMetadata(simple.metadata, {
  status: 200, existingTags: simple.tags, sitemapIncluded: true, locale: "en"
});

// From the versioned resolver in section 8:
const detailedIssues = auditSeoV1({
  resolution,
  visibility: "public",
  sitemapIncluded: true,
  existingCanonicalCount: 1,
  expectedLocale: "en-US"
});
for (const issue of [...basicIssues, ...detailedIssues]) {
  console.log(issue.severity, issue.code, issue.message, issue.path);
}
```

### Unversioned `auditMetadata` codes

| Code | Severity | Reported condition |
|---|---|---|
| SEO001 | Error | Missing or empty title |
| SEO002 | Warning | Missing or empty description |
| SEO003 | Info | Description length under 50 characters |
| SEO004 | Warning | Indexable page lacks canonical |
| SEO005 | Error | Private page marked indexable |
| SEO006 | Error | HTTP error status (≥400) marked indexable |
| SEO007 | Error | Sitemap includes noindex/private page |
| SEO008 | Info | No Open Graph image |
| SEO009 | Error | Duplicate canonical tags in supplied existing tags |
| SEO010 | Error | Invalid structured data |
| SEO011 | Error | Invalid hreflang locale label |
| SEO012 | Error | Invalid hreflang URL |

### `auditHreflang` codes

| Code | Severity | Reported condition |
|---|---|---|
| SEO201 | Error | Invalid locale label |
| SEO202 | Warning | Missing reciprocal alternate for a destination present in the input set |

### Versioned `auditSeoV1` codes

| Code | Severity | Reported condition |
|---|---|---|
| SEO300 | Error | Invalid protocol version |
| SEO301 | Error | Public 200 response has no valid title |
| SEO302 | Warning | Public 200 response lacks description |
| SEO303 | Error | Public 200 response lacks canonical |
| SEO304 | Error | Canonical invalid, not absolute HTTPS or unsafe |
| SEO305 | Error | Private/error/redirect response is indexable |
| SEO306 | Error | Forbidden response retains canonical or JSON-LD |
| SEO307 | Error | Sitemap includes a nonindexable response |
| SEO308 | Error | Multiple canonical tags detected |
| SEO309 | Error | Redirect 301/302/307/308 has no validated Location |
| SEO310 | Error | Invalid JSON-LD |
| SEO311 | Warning | Locale differs from expected locale |
| SEO312 | Info | No Open Graph preview image |

**Note:** these are the currently implemented codes, not an exhaustive set of possible SEO audits. Audits are complementary to actual rendered HTML, sitemap XML, HTTP header/status, accessibility and crawler inspection.

## 14. Security, privacy, correctness and limits

1. **Authorization boundary:** noindex, robots.txt and sitemap omission do not protect private content. Perform authentication/authorization before loaders, metadata and public sitemap feed selection. Do not cache user-specific metadata globally.
2. **Status boundary:** supply the actual HTTP status and visibility. On nonpublic/non-200 pages, factories are not evaluated and public discovery metadata is removed. The SEO package cannot force the HTTP response status by itself.
3. **Trusted origins:** never derive `siteURL` or `siteOrigin` directly from an untrusted request `Host` header. Explicitly allowlist cross-origin destinations and prefer HTTPS; v1 requires HTTPS for site origin and resolved targets.
4. **Safe head output:** use `serializeHeadTags` on unversioned `HeadTag` data. It enforces an allowlist of tag kinds and attributes, rejects extra event-handler attributes, rejects unsafe links and reserializes JSON-LD. The v1 head adapter returns *different structural entries* that the host must serialize safely under its CSP.
5. **JSON-LD safety:** reject functions, circular structures, dangerous object keys and malformed `@context`; escape script breakouts. Structured data should accurately reflect visible authorized facts. Do not claim rich-result eligibility.
6. **Redirect safety:** v1 redirects require the expected status/Location pair and validated HTTPS origin; redirect `Location` preserves query, fragment and slash semantics.
7. **SPA lifecycle:** reject stale navigation versions, aborted updates, malformed tag data; adopt/reconcile stale SSR SEO head and remove duplicate canonicals. Dispose per owner/navigation lifecycle.
8. **Sitemap exposure:** filter public records upstream. Duplicate conflicting records throw; records and XML sizes are bounded; timestamps represent meaningful page revisions; each file and index must be publicly deployed and served correctly.
9. **Performance/reproducibility:** pure data functions do not automatically fetch, run AI, import the compiler, or inject analytics. Sitemap output is sorted, deterministic for equivalent normalized inputs, bounded by options and suitable for pinned builds. No isolated SEO bundle-size or live indexing benchmark is claimed.
10. **Compliance:** crawler rules and metadata are advisory; SEO does not handle data consent, tracking vendors, search submission or privacy regulation compliance.

### Common errors and actionable fixes

| Error / symptom | Cause | Action |
|---|---|---|
| `Untrusted cross-origin canonical URL` | External URL without explicit trust | Correct `siteURL` or narrowly configure `allowedOrigins` |
| `Unsafe canonical URL` / malformed percent encoding | Bad scheme, credentials, `//`, invalid escape or control char | Reject or fix upstream URL data; never force-accept |
| `Expected zaakiy.seo/1 document` | Missing/incorrect `version: 1` | Return typed `SeoDocumentV1` |
| `Redirect status and Location must agree` | 3xx without matching redirect config, or redirect config on non-3xx | Make status and `redirect.status` agree; supply validated destination |
| `No SEO factory for route` | Adapter route ID not registered | Register the existing router's route ID |
| `Missing Router-provided SEO route params` | Neither `params` nor `resolveParams` configured | Supply request-scoped matched params |
| `Too many JSON-LD records` / 128 KiB | V1 JSON-LD bounds exceeded | Emit fewer, relevant schema objects |
| `Conflicting metadata for duplicate sitemap canonical` | Same normalized URL has different XML record metadata | Deduplicate in source, use authoritative revision |
| `Sitemap feed cursor loop or invalid cursor` | Repeated or oversized pagination cursor | Fix feed cursor progression |
| Sitemap includes private URL | Source improperly admitted a private record, or omitted eligibility flags | Fix upstream authorization/publication query; do **not** rely on filters alone |
| SPA head shows stale metadata | Missing revision ordering or manager disposed incorrectly | Use monotonic `version` and owner/abort lifecycle |
| Search engine does not index page | Many possible search/policy/content factors beyond this library | Verify HTTP status, canonical, robots, public HTML, crawlability and indexing diagnostics externally |

## 15. Testing, deployment and troubleshooting

### Workspace commands (before npm publication)

From the monorepo root:

```sh
pnpm install --frozen-lockfile
pnpm --filter @zaakiyjs/seo lint
pnpm --filter @zaakiyjs/seo typecheck
pnpm --filter @zaakiyjs/seo build
pnpm --filter @zaakiyjs/seo test
pnpm --filter @zaakiyjs/seo pack:check
```

Existing SEO tests cover: typed inheritance/route ancestry, private/non-200 safety, canonical allowlists, HTML injection escaping, JSON-LD validation, parser checks, redirects (including query-only destinations), locale alternates, deterministic sitemaps and conflicting duplicates, limits/invalid calendar dates, feed pagination/cancellation, and JSDOM head adoption/disposal. **These tests do not by themselves certify real production search indexing.** Repository-wide CI additionally gates browser engines, packaged external consumption, reproducible builds, CSP, accessibility and heap regressions.

### Minimal acceptance checklist for an application

- A publicly visible `200` page emits one absolute canonical, correct title/description, safe OG/JSON-LD, and an actual HTTP `200`.
- A denied/private/draft/`404`/`410` page emits `noindex, nofollow`, no public canonical/JSON-LD and a **real** corresponding status.
- A redirect returns an actual `301/302/307/308` with an approved `Location` preserving meaningful query/fragment.
- Every public locale's hreflang set is deliberate and reciprocal.
- Sitemaps include only authorized published pages, point to real canonical URLs, are served as valid XML and include truthful `lastmod`.
- Browser navigation does not leave obsolete server-rendered head tags or duplicate canonicals, and teardown removes owned nodes.
- Build, typecheck, test, CI browsers, CSP/accessibility and consumer pack checks pass on the final merged code.

### Deployment responsibilities and limitations

A production server must set `Content-Type` (HTML/XML/plain text as appropriate), enforce CSP/security headers, handle caching and redirects, and emit the actual status. Public static generation and SSR integration are application/deployment responsibilities. If serving split sitemap files, serve each `build.files[].filename` and an index XML endpoint whose contents are `build.index`. Include public sitemap URLs in `robots.txt` when appropriate.

The package is **unreleased `0.0.0`**. The package README and Changeset should govern release notes; npm scope ownership, root license approval, independent SemVer first release, supply-chain provenance and explicit publication authorization remain separate gates. A successful `npm pack` does not authorize publishing. The SEO PR should not be described as fully validated until every check on the final commit has completed successfully.

## 16. Public API inventory and compatibility

The following inventory is derived from `src/index.ts` and `src/browser.ts`. Do not import internal source files.

### Runtime exports from `@zaakiyjs/seo`

| Group | Named exports |
|---|---|
| Metadata | `defineMetadata`, `definePageMetadata`, `resolveMetadata`, `resolveRouteMetadata`, `renderMetadata` |
| Head tags / response header | `metadataToTags`, `serializeHeadTags`, `robotsContent` |
| URL / encoding | `normalizeCanonical`, `escapeHtml`, `escapeXml` |
| JSON-LD | `defineStructuredData`, `validateStructuredData`, `serializeJsonLd` |
| Robots.txt | `generateRobotsTxt` |
| Sitemap | `generateSitemaps`, `generateSitemapIndex`, `planSitemapRebuild`, `auditHreflang` |
| Legacy audits | `auditMetadata` |
| Frozen v1 | `resolveSeoV1`, `seoToRenderHeadV1`, `seoRobotsHeaderV1`, `createSeoHeadAdapterV1`, `generateSitemapsFromFeedV1`, `auditSeoV1` |

### Type-only exports from `@zaakiyjs/seo`

- Metadata/response: `Metadata`, `MetadataDefinition`, `PageMetadataContext`, `ResolveMetadataOptions`, `ResolvedMetadata`, `CanonicalPolicy`, `SocialMetadata`, `TwitterMetadata`, `RobotsDirectives`, `StructuredData`, `StructuredDataInput`, `HeadTag`, `RenderedMetadata`, `RouteSeoConfig`.
- Robots/sitemap: `RobotsGroup`, `RobotsTxtOptions`, `SitemapEntry`, `SitemapOptions`, `GeneratedSitemap`, `SitemapIndexEntry`, `SitemapBuild`, `HreflangPage`.
- Auditing: `SeoDiagnostic`, `AuditOptions`, `DiagnosticSeverity`, `SeoAuditInputV1`.
- Versioned SEO: `JsonLdValueV1`, `SeoRobotsV1`, `SeoDocumentV1`, `SeoResolveInputV1`, `SeoFactoryV1`, `SeoResolutionV1`, `SeoResolveOptionsV1`, `SeoRouteBindingV1`, `RenderHeadEntryV1`, `RenderHeadAdapterV1`.
- Versioned sitemap: `SitemapEntryV1`, `SitemapFeedV1`, `SitemapFeedOptionsV1`.

### Optional `@zaakiyjs/seo/browser` exports

- Runtime: `createHeadManager`.
- Type: `HeadManager`.

### Architectural compatibility

This package can produce data for future `@zaakiyjs/ssr` and consume authoritative route-loader results, but **does not import SSR, Router internals, Compiler, DOM runtime, AI, Analytics, Ads or Consent**. The P3 structural head adapter is not a replacement for the application's authorized routing or an SSR renderer. The unversioned metadata API and frozen v1 protocol are maintained as **distinct public shapes**; use an explicit adapter if your application must move between them.

---

**Source of truth:** [`src/index.ts`](../src/index.ts), [`src/protocol.ts`](../src/protocol.ts), [`src/metadata.ts`](../src/metadata.ts), [`src/sitemap.ts`](../src/sitemap.ts), [`src/browser.ts`](../src/browser.ts), and [`test/`](../test/). Update this guide when any exported signature, behavioral contract or documented limit changes.
