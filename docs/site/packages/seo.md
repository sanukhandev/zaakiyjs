---
title: "@zaakiyjs/seo"
description: "Implemented pure metadata, route SEO, JSON-LD, canonical policies, robots and sitemap protocols"
sidebar_position: 22
---

# @zaakiyjs/seo — metadata and crawler output

> **Availability:** Source package merged to `main` in [PR #51](https://github.com/sanukhandev/zaakiyjs/pull/51) (`10df2c23a861`). Unpublished `0.0.0`; use in this repository's workspace until independent npm release approval. This is an SEO data engine, **not** a server HTML renderer, router, hydration runtime or guarantee of search engine indexing.

## At a glance

- **Inputs:** trusted site origin, authoritative HTTP status and route visibility, completed authorized route loader data and optional metadata factories
- **Outputs:** escaped metadata/head entries, canonical and social URLs, validated JSON-LD, robots headers/directives, robots.txt, deterministic XML sitemap pages and incremental sitemap plans
- **Runtime boundary:** `@zaakiyjs/seo` is a pure universal data package; only `@zaakiyjs/seo/browser` touches `document` for managed SPA head updates
- **Source:** [package README](../../../packages/seo/README.md), [exhaustive 16-section integration guide](../../../packages/seo/docs/complete-guide.md), [public exports](../../../packages/seo/src/index.ts), [frozen contract](../../contracts/14-seo.md)

## Try it from the monorepo

```sh
pnpm --filter @zaakiyjs/seo lint
pnpm --filter @zaakiyjs/seo typecheck
pnpm --filter @zaakiyjs/seo build
pnpm --filter @zaakiyjs/seo test
```

## Static metadata, canonical and JSON-LD

```ts
import { defineMetadata, renderMetadata, generateSitemaps } from '@zaakiyjs/seo';

const defaults = defineMetadata({
  title: 'Catalogue',
  description: 'Public products'
});
const result = renderMetadata([
  defaults,
  {
    title: 'Safe Lamp',
    canonical: '/products/lamp',
    structuredData: { '@type': 'Product', name: 'Safe Lamp' }
  }
], { siteURL: 'https://shop.example.test', status: 200, trailingSlash: 'never' });

console.log(result.html); // escaped head content; host inserts in trusted response
console.log(result.headers['X-Robots-Tag']); // apply at the actual HTTP boundary

const site = await generateSitemaps([
  { loc: '/products/lamp', published: true, lastmod: '2026-11-01' }
], { siteURL: 'https://shop.example.test' });
```

For the complete static API, canonical normalization, Meta/OG/Twitter, locale/hreflang, JSON-LD schema policy and serialization examples, see the [implementation guide](../../../packages/seo/docs/complete-guide.md).

## Dynamic SEO based on authoritative route data

```ts
import { definePageMetadata, resolveRouteMetadata } from '@zaakiyjs/seo';

const product = definePageMetadata<{ name: string; slug: string }>(({ data }) => ({
  title: data.name,
  canonical: '/products/' + encodeURIComponent(data.slug)
}));

const resolved = resolveRouteMetadata(
  'product',
  [
    { id: 'root', metadata: { publisher: 'Example' } },
    { id: 'product', parentId: 'root', metadata: product }
  ],
  { description: 'Browse products' },
  { siteURL: 'https://shop.example.test', data: { name: 'Lamp', slug: 'lamp' }, status: 200 }
);
```

Route and server adapters own route selection, access policy, loader execution, status and redirect responses. SEO merges trusted defaults/layouts/route metadata but never performs authorization. For private, draft, redirected, missing, deleted or other non-200 responses, the versioned resolver does not call loader-dependent metadata factories and produces noindex-safe results without private canonical or JSON-LD.

## Versioned SEO and SSR head protocol

```ts
import { resolveSeoV1, seoToRenderHeadV1 } from '@zaakiyjs/seo';

const siteOrigin = new URL('https://shop.example.test');
const result = await resolveSeoV1({
  routeId: 'product',
  url: new URL('/products/lamp', siteOrigin),
  siteOrigin,
  params: { slug: 'lamp' },
  loaderData: { name: 'Lamp' },
  visibility: 'public',
  status: 200
}, ({ loaderData }) => ({
  version: 1,
  title: loaderData.name,
  canonical: '/products/lamp',
  jsonLd: [{ '@type': 'Product', name: loaderData.name }]
}));
const entries = seoToRenderHeadV1(result);
```

The `zaakiy.seo/1` result can be adapted using `createSeoHeadAdapterV1` for trusted SSR/SSG hosts. The host still owns response headers, real HTTP status, CSP nonces, content security and routing. `seoRobotsHeaderV1` derives crawler headers. The SEO package does **not** provide compiler-generated SSR or DOM hydration; those remain [SSR integration issue #59](https://github.com/sanukhandev/zaakiyjs/issues/59).

## SPA head adoption

```ts
import { createHeadManager } from '@zaakiyjs/seo/browser';
import { renderMetadata } from '@zaakiyjs/seo';

const abort = new AbortController();
const head = createHeadManager(document, abort.signal);
head.update(
  renderMetadata({ title: 'Products', canonical: '/products' }, {
    siteURL: 'https://shop.example.test'
  }),
  { version: 1 }
);
abort.abort(); // removes managed metadata and listeners
```

The browser manager adopts existing SEO-related SSR tags, removes stale canonical/social/JSON-LD tags, rejects stale or cancelled navigation versions and preserves unrelated head elements. Initial crawler-indexable HTML should still be server-rendered when possible.

## Sitemap feeds, robots and localization

- `generateRobotsTxt` serializes crawler directives; robots are **not** authentication.
- `generateSitemaps` filters ineligible/private/noindex/redirect/non-200/soft-404 records, rejects conflicting canonical duplicates, sorts deterministically and escapes XML.
- `generateSitemapIndex` constructs a bounded index; page limits are at most 50,000 URLs and 50 MB. URLs at or above 2048 characters and invalid calendar dates are rejected.
- `generateSitemapsFromFeedV1` accepts versioned `zaakiy.sitemap/1` paginated data with cancellation and bounded traversal; the server must independently authorize each record.
- `planSitemapRebuild` supports changed-content rebuild planning; `auditHreflang` checks locale alternate consistency.
- Never fabricate `lastmod` timestamps or expose authenticated URLs in public sitemap output.

## Security, privacy and diagnostics

- Trusted canonical base origin is mandatory; unsafe schemes, malformed encoding, credentials and unapproved cross-origin URLs are rejected.
- JSON-LD is validated and serialized with script-context escaping; search rich-result eligibility is not guaranteed.
- Private/non-200 responses must not disclose route metadata; the site host enforces access control and real HTTP status.
- `auditMetadata` and `auditSeoV1` emit diagnostic codes for missing metadata, forbidden indexability, canonical and structured-data constraints.
- The package has no analytics SDK, network collection, persistent identity, compiler runtime or browser-side AI dependency.
- Third-party scripts and preloads still require application-side consent and CSP policies.

## Public API index

These names are parsed from the merged `packages/seo/src/index.ts` root entrypoint. The optional browser-only `createHeadManager` is exported from `@zaakiyjs/seo/browser`, not from this root list.

- `auditHreflang`
- `auditMetadata`
- `AuditOptions`
- `auditSeoV1`
- `CanonicalPolicy`
- `createSeoHeadAdapterV1`
- `defineMetadata`
- `definePageMetadata`
- `defineStructuredData`
- `DiagnosticSeverity`
- `escapeHtml`
- `escapeXml`
- `GeneratedSitemap`
- `generateRobotsTxt`
- `generateSitemapIndex`
- `generateSitemaps`
- `generateSitemapsFromFeedV1`
- `HeadTag`
- `HreflangPage`
- `JsonLdValueV1`
- `Metadata`
- `MetadataDefinition`
- `metadataToTags`
- `normalizeCanonical`
- `PageMetadataContext`
- `planSitemapRebuild`
- `RenderedMetadata`
- `RenderHeadAdapterV1`
- `RenderHeadEntryV1`
- `renderMetadata`
- `ResolvedMetadata`
- `resolveMetadata`
- `ResolveMetadataOptions`
- `resolveRouteMetadata`
- `resolveSeoV1`
- `robotsContent`
- `RobotsDirectives`
- `RobotsGroup`
- `RobotsTxtOptions`
- `RouteSeoConfig`
- `SeoAuditInputV1`
- `SeoDiagnostic`
- `SeoDocumentV1`
- `SeoFactoryV1`
- `SeoResolutionV1`
- `SeoResolveInputV1`
- `SeoResolveOptionsV1`
- `seoRobotsHeaderV1`
- `SeoRobotsV1`
- `SeoRouteBindingV1`
- `seoToRenderHeadV1`
- `serializeHeadTags`
- `serializeJsonLd`
- `SitemapBuild`
- `SitemapEntry`
- `SitemapEntryV1`
- `SitemapFeedOptionsV1`
- `SitemapFeedV1`
- `SitemapIndexEntry`
- `SitemapOptions`
- `SocialMetadata`
- `StructuredData`
- `StructuredDataInput`
- `TwitterMetadata`
- `validateStructuredData`

## Detailed feature guide

The [Complete SEO Usage and Integration Guide](../../../packages/seo/docs/complete-guide.md) covers all public features with typed examples and correctness criteria: static and route metadata, layout inheritance, social previews, canonical URL policies, localized alternates, JSON-LD, robots, versioned v1 contracts, SSR/SSG head adapters, safe SPA updates, static/dynamic sitemap feeds, diagnostics, security restrictions, deployment and troubleshooting. For interfaces evolving with Router or SSR, verify the relevant package's actual exported APIs and current integration tests. No package release or search-result ranking claim follows from this merge.
