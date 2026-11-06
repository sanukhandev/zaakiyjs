# Contract 14 — metadata, structured data and discovery (P3 SEO v1)

- **Status:** Frozen **design**, not implemented.
- **Owner:** proposed `@zaakiyjs/seo`; `zaakiy.seo/1` and `zaakiy.sitemap/1`.
- **Independence:** pure data/functions usable in Node static builds, SSG, SSR adapters and client title updates; **no required SSR or Router runtime dependency**.

## Pure metadata model (reserved)

~~~ts
type SeoRobotsV1 = {
  readonly index?: boolean; readonly follow?: boolean;
  readonly noarchive?: boolean; readonly nosnippet?: boolean;
  readonly maxSnippet?: number; readonly maxImagePreview?: "none" | "standard" | "large";
};
type JsonLdValueV1 = null | string | number | boolean | readonly JsonLdValueV1[] |
  { readonly [key: string]: JsonLdValueV1 };
interface SeoDocumentV1 {
  readonly version: 1;
  readonly title?: string;
  readonly description?: string;
  readonly canonical?: string; // absolute https URL after origin resolution
  readonly robots?: SeoRobotsV1;
  readonly openGraph?: {
    readonly type?: "website" | "article" | "product";
    readonly title?: string; readonly description?: string;
    readonly url?: string; readonly siteName?: string;
    readonly images?: readonly { readonly url: string; readonly alt?: string;
      readonly width?: number; readonly height?: number }[];
  };
  readonly social?: { readonly card?: "summary" | "summary_large_image";
    readonly title?: string; readonly description?: string;
    readonly image?: string; readonly imageAlt?: string };
  readonly locale?: string; // valid BCP 47
  readonly alternates?: readonly { readonly hreflang: string; readonly url: string }[];
  readonly jsonLd?: readonly JsonLdValueV1[];
}
interface SeoResolveInputV1<Data = unknown> {
  readonly routeId: string; // existing Router route ID
  readonly url: URL; readonly params: Readonly<Record<string, string>>;
  readonly loaderData: Data; readonly status: number;
  readonly visibility: "public" | "private" | "draft";
  readonly siteOrigin: URL; // configuration, not inferred from Host header
}
type SeoFactoryV1<Data> = (input: SeoResolveInputV1<Data>) =>
  SeoDocumentV1 | Promise<SeoDocumentV1>;
interface SeoResolutionV1 {
  readonly version: 1;
  readonly status: number; // authoritative status supplied by route/server
  readonly metadata: SeoDocumentV1;
  readonly redirect?: { readonly status: 301 | 302 | 307 | 308; readonly location: string };
}
interface SitemapEntryV1 {
  readonly loc: string; // absolute https URL
  readonly lastmod?: string; // ISO 8601 date/time tied to meaningful content revision
  readonly changefreq?: "always" | "hourly" | "daily" | "weekly" | "monthly" | "yearly" | "never";
  readonly priority?: number; // 0..1, optional hint only
  readonly alternates?: readonly { readonly hreflang: string; readonly url: string }[];
  readonly visibility: "public";
}
interface SitemapFeedV1 {
  readonly schema: "zaakiy.sitemap/1";
  entries(input: { readonly signal: AbortSignal; readonly cursor?: string }):
    Promise<{ readonly items: readonly SitemapEntryV1[]; readonly nextCursor?: string }>;
}
~~~

`JsonLdValueV1` is a bounded JSON tree, **not** a trusted HTML string. The serializer must validate permitted `@context` values, disallow `__proto__`/prototype pollution and malicious script-breakout strings, enforce nesting/size limits, escape in HTML context and serialize deterministically. JSON-LD content must reflect the visible page facts; schema validation appropriate to the chosen Schema.org type belongs in the SEO implementation. Canonical, Open Graph and hreflang targets must be normalized against a configured trusted site origin and an explicit HTTPS allowlist; refuse `javascript:`, foreign unapproved origins, credentials and unsafe control chars.

## Status and route-loader precedence

Existing Router owns path matching, guards and loader execution; SEO **does not** introduce routes, fetch loaders or own authorization. Applications attach a pure `SeoFactoryV1<Data>` to route IDs via a future public adapter/registration API. `RouteDefinition.metadata` is currently generic `Readonly<Record<string, unknown>>` and is **not** a typed SEO API; a compiler/router bridge requires independent review.

Metadata merge order: trusted site defaults -> layout/parent defaults -> route factory receiving **completed, authorized loader data** -> explicit response-status safety rules. Canonical is one absolute URL; repeated values (hreflang and OG images) deduplicate deterministically. Locale sets require matching reciprocal links including an optional `x-default`, validated against canonical URLs. Query/hash and pagination canonical strategy must be configured by the site, not guessed by the framework.

- `200` and public: indexability configurable; no `index` guarantee from search engines.
- `404` and `410`: real HTTP status from the host; force `robots.index = false` and exclude from sitemaps. SEO metadata cannot silently turn a missing product into HTTP 200.
- Redirect `3xx`: validated `Location` and no body metadata that asserts indexable destination content. A redirect is a server response decision, not a meta refresh.
- `401`/`403`, private, draft, unapproved or unknown visibility: force `noindex`, disable public discovery and prohibit private JSON-LD leakage. If loader fails or aborts, do not fabricate indexable metadata.

## Public integration boundary

`@zaakiyjs/seo` returns **data** (`SeoResolutionV1`). The deployment/application adapter maps it to `RenderHeadEntryV1` from Contract 13 through `RenderHeadAdapterV1`; SSR consumes only that public adapter and never imports SEO private modules. The same pure resolver can feed static-site generation without SSR. Neither SSR nor SEO may import the other's `src` path. HTML creation must apply escaping, CSP and URL verification at the final renderer, not pass unchecked HTML strings through the head adapter.

Sitemap discovery traverses **published, authorized, canonical** records only; pagination/cursor traversal is bounded and interruptible. Exclude private/draft/deleted/noncanonical/blocked pages. `lastmod` indicates substantive changes, not deployment time; sitemap indexes and chunk limits must conform to deployed search-engine protocols. Robots policies are advisory to crawlers, not authorization.

## Acceptance and deferrals

Fixture matrix: successful dynamic product from loader -> matching title/canonical/OG/JSON-LD; missing/deleted -> HTTP 404/410 plus noindex; auth-only -> noindex/no sitemap; redirect -> correct status/Location; mixed locales reciprocal alternates; malicious description/JSON-LD escapes; deterministic sitemap snapshot, pagination and published-only filtering. Check generated actual HTML, not only pure objects. **No SEO package or metadata serializer exists at P3-00; no runtime claims.**
