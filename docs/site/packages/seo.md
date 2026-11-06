---
title: "@zaakiyjs/seo (planned)"
description: "P3 SEO contract: metadata, indexability, structured data and sitemaps"
sidebar_position: 22
---

# @zaakiyjs/seo — design contract

> **Status: Not an implemented package on the documented main revision.** This is a detailed guide to the frozen P3 [SEO contract](../../contracts/14-seo.md), **not** an installable API reference. Do not import `@zaakiyjs/seo` or copy reserved type names as runtime exports until implementation and merge are independently verified.

## Problem and intended use

SEO must provide reliable metadata for static and dynamically loaded public pages without inventing a second router. Routes and server adapters own the authoritative HTTP status, access decision and loader data; SEO produces **pure metadata data structures** that a trusted rendering adapter serializes safely.

Use cases include catalog/product detail pages with real canonical URLs and JSON-LD, locale alternates, private account areas that must never enter public discovery, dynamic 404/410 responses and sitemaps from published records.

## Reserved feature model

| Feature | Frozen contract | Usage rule |
| --- | --- | --- |
| Document metadata | `SeoDocumentV1` | Title, description, canonical, robots, Open Graph, social card, locale, alternates, bounded JSON-LD |
| Route resolution | `SeoResolveInputV1` / `SeoFactoryV1` | Consume route ID, URL, params, **authorized completed loader data**, real status and visibility |
| Resolution result | `SeoResolutionV1` | Data + authoritative status, optional validated redirect |
| Sitemap discovery | `SitemapFeedV1`, `SitemapEntryV1` | Only published public canonical pages; bounded cursor feeds with AbortSignal |
| Integration | Contract 13 `RenderHeadAdapterV1` | HTML escaping/CSP in rendering boundary, not inside arbitrary metadata strings |

These are **reserved type-level design names**; no implemented symbol is promised here.

## Intended feature flow: dynamic product detail

1. Router matches a public product route and completes authorization, guards and loader.
2. Repository loader returns published product data or a genuine missing/deleted response.
3. A pure route metadata factory receives the loader result and **actual** status.
4. The resolver merges trusted site defaults, layout defaults and route metadata in that order.
5. Server output serializes exactly one canonical target, escaped metadata and bounded JSON-LD.
6. If the product is 404/410, force noindex and exclude it from sitemap. If private/draft, do not disclose private metadata.
7. SSR/SSG output is tested as actual HTML with correct HTTP response status; browser title updates can share the pure resolution result.

A canonical is not inferred from untrusted Host headers; configure a trusted HTTPS site origin. Query/hash and paginated canonical strategy must be an explicit application rule.

## Content and security requirements

JSON-LD is structured bounded JSON data, not an HTML string. A future implementation must reject malicious keys, prototype pollution, unsafe context URLs, oversized trees and script breakout sequences. Normalize and validate Open Graph, hreflang and canonical URLs against allowed origins. Hreflang sets must be reciprocal, with locale validity and optional `x-default`.

Robots directives are crawler hints, not authentication. Private routes need enforceable backend auth and authoritative noindex logic.

## Implementation acceptance

- Public dynamic page: correct title, OG, canonical, Schema.org structure and HTTP 200.
- Missing/deleted page: real HTTP 404/410, noindex and excluded sitemap entry.
- Redirect: valid 3xx status and Location, not a meta-refresh substitute.
- Private/auth-only: zero sensitive JSON-LD and no public sitemap inclusion.
- Sitemap: bounded pagination, deterministic order, meaningful `lastmod` values and cancellation.
- Security: malicious HTML/URL payloads never become executable markup.
- Integration: build-only and server use without mandatory Router/SSR runtime imports.

## References

- [P3 SEO contract](../../contracts/14-seo.md)
- [SSR/rendering contract](../../contracts/13-rendering-ssr.md)
- [SSR foundation package](./ssr.md)
- [Router package](./router.md)
- [Rendering architecture](../../architecture/rendering-and-seo.md)
