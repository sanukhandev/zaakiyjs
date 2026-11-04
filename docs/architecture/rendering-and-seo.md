# Rendering, Dynamic SEO and Cache Invalidation

## Rendering strategies

Route-level choice: client rendering (private apps), static generation (stable public pages), server rendering (frequently changing public pages), and hybrid incremental regeneration with on-demand invalidation for large catalogs/CMS. All SSR/SSG/hydration APIs are proposed future contracts, not implemented features.

Compiler IR must have enough semantic fidelity for future server HTML output. Keep per-request provider scopes isolated. Hydration must preserve input value/focus and detect/recover from mismatches without exposing private data.

## Dynamic route contract (proposed)

```tsx
definePage({
  route: "/products/:slug",
  rendering: { mode: "hybrid", revalidate: 300 },
  load: ({ params, services }) => services.products.bySlug(params.slug),
  seo: ({ data }) => ({
    title: data.name,
    description: data.description,
    canonical: "/products/" + data.slug,
    structuredData: { "@type": "Product", name: data.name }
  }),
  component: ProductPage
});
```

The same authoritative record generates visible HTML, metadata and structured data. Avoid bot-specific content divergence. Return real HTTP `404`/`410` for missing resources and appropriate redirects/status codes.

## SEO responsibilities

`@zaakiyjs/seo` owns canonical URLs, page defaults/overrides, Open Graph, robots, sitemaps/sitemap index, typed JSON-LD, locale/hreflang, dynamic published-record discovery, and SEO diagnostics. Sitemaps must exclude private, draft, duplicate, blocked and unauthorized pages. Correct `lastmod` follows meaningful content changes, not every build.

## Cache/invalidation

Each rendered cache entry has explicit TTL/tags/content identity/authorization scope. Support time-based revalidation and authenticated on-demand invalidation events from CMS/backend; no stale authorized content served to another user. Limit regeneration concurrency and prevent stampedes. CLI cannot invalidate a deployed environment without a configured authenticated service integration.

## Privacy/ads/analytics

`analytics`, `ads` and `consent` remain optional separate packages; respect regional consent signals and vendor policies. Advertising slots should reserve layout space to avoid CLS; no hidden tracking or ad runtime in core.

## Quality metrics

Track LCP, INP, CLS from real-browser lab/field data, plus indexability, meta completeness, redirects and sitemap validity. Search engine indexing is not guaranteed simply because HTML is valid. Include accessibility and performance gates for prerendered output.
