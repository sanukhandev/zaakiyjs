# P3 — rendered page ownership and testable acceptance fixture

**Status:** Normative **design fixture**, not runnable P3 code in the current repository. Use as the first end-to-end contract/interoperability fixture after implementations exist. The existing Router matcher is real; the `ssr`/`seo`/`consent`/`analytics`/`ads` APIs below are illustrative interfaces only.

## Scenario and input

Application has two routes registered through existing Router `defineRoute` / `compileRoutes`:

- Public `id: "product"`, `path: "/products/:slug"`, future mode `hybrid`, public TTL 300s, tag `product:sku-7`; loader retrieves **one authorized published product record** and not a second SEO-only record.
- Private `id: "account"`, `path: "/account"`, future mode `csr`, `no-store`, `noindex` and no public sitemap entry.

Fixture record and request:

~~~json
{
  "request": { "method": "GET", "url": "https://shop.example.test/products/sku-7" },
  "product": {
    "slug": "sku-7", "title": "Safe Lamp", "description": "Indoor light",
    "price": 35, "currency": "USD", "published": true,
    "updatedAt": "2026-11-01T08:00:00Z"
  },
  "consent": {
    "schema": "zaakiy.consent/1", "revision": 0,
    "policyId": "test-policy", "policyVersion": "1",
    "grants": {
      "essential": { "purpose": "essential", "decision": "granted" },
      "analytics": { "purpose": "analytics", "decision": "unknown" },
      "advertising": { "purpose": "advertising", "decision": "unknown" },
      "ad-personalization": { "purpose": "ad-personalization", "decision": "unknown" },
      "functional-third-party": { "purpose": "functional-third-party", "decision": "unknown" }
    }
  }
}
~~~

`shop.example.test` is an illustrative configured origin, **not** a live site; integration tests supply a local test origin. No runtime should infer it from an untrusted Host header. Optional consent purposes start `unknown`.

## Ownership through one request

| Step | Owner | Contract boundary | Observable expectation |
| --- | --- | --- | --- |
| 1. Match `/products/sku-7` | Router | `compileRoutes` and `matchRoutes` | `routeId = product`, param `slug = sku-7`, no second matcher |
| 2. Resolve data | application loader/Model | Router loader + scoped service | one published product snapshot, abort-aware; 404 if missing |
| 3. Render | SSR/Compiler trusted server build | `RenderRoutePolicyV1`, `ServerRequestContextV1` | new Core owner; valid 200 HTML; no `Node` execution on server |
| 4. Resolve title/head | SEO | `SeoFactoryV1<Product>` -> `SeoDocumentV1` | title `Safe Lamp`; canonical `https://shop.example.test/products/sku-7`; matching OG/JSON-LD Product |
| 5. Integrate head | app adapter -> SSR | `RenderHeadAdapterV1` | escaped title, canonical link, metadata and safe `application/ld+json` |
| 6. Cache | SSR | `RenderCachePolicyV1` | public key includes route/build/content revision; tag `product:sku-7`; TTL 300 |
| 7. Hydrate | SSR client + DOM/Core | `HydrationEnvelopeV1` | verify markers/build, attach once; preserve focus and edited input |
| 8. Consent | Consent application adapter | `ConsentSnapshotV1` -> `ConsentCapabilityV1` | optional `can()` false; no vendor load |
| 9. Measure | Analytics (optional) | `AnalyticsProviderV1` | zero event/observer/network calls with unknown state |
| 10. Reserve ad | Ads (optional) | `AdSlotV1` | visible labeled reserved region, no iframe/vendor call before grant |
| 11. Discover page | SEO static sitemap | `SitemapFeedV1` | one canonical published URL, `lastmod = 2026-11-01T08:00:00Z` |

## Expected output assertions

~~~ts
// Pseudocode: implement with real response + DOM/Playwright once P3 packages exist.
expect(response.status).toBe(200);
expect(response.headers.get("content-type")).toContain("text/html");
expect(document.title).toBe("Safe Lamp");
expect(canonicalHref).toBe("https://shop.example.test/products/sku-7");
expect(jsonLd["@type"]).toBe("Product");
expect(jsonLd.name).toBe("Safe Lamp");
expect(sitemapUrls).toContain("https://shop.example.test/products/sku-7");
expect(consent.can("analytics")).toBe(false);
expect(consent.can("advertising")).toBe(false);
expect(consent.can("ad-personalization")).toBe(false);
expect(analyticsProviderStartCount).toBe(0);
expect(adProviderStartCount).toBe(0);
expect(unrelatedDomMutations).toBe(0);
~~~

These assertions are **not claimed to have been run**. The document title/head APIs are an adapter output, not an instruction to use `innerHTML`. Expected sample HTML must escape attacker-controlled product strings, including `</script>` in JSON-LD and attributes. CSP and URL policy apply at serialization.

## Negative/revocation cases

| Variant | Required result |
| --- | --- |
| `/products/missing` | 404 HTTP, `robots:noindex`, no sitemap record, no fabricated Product JSON-LD |
| `/products/gone` | 410 HTTP, `robots:noindex`, no sitemap record |
| `/account` with anonymous visitor | CSR shell or auth redirect/401, `no-store`, `noindex`, zero private data in HTML/cache/sitemap |
| Product title `<img src=x onerror=alert(1)>` | escaped text; no executed script, invalid DOM or untrusted HTML |
| Two simultaneous tenant/user requests | separate Core provider roots, no cross-scope loader data, cache partitions never share user HTML |
| Stale/wrong-build hydration marker | safe abort or configured owned-boundary replacement; no double listener or focus loss |
| User grants **analytics only** | analytics may initialize and emit one committed pageview; ads remain blocked |
| User grants **advertising only** | compliant nonpersonalized placement may load, personalized placement remains blocked |
| Provider requires **advertising + ad-personalization** but slot requires **advertising only** | permission **union** requires both grants; block until personalization granted |
| User grants **advertising + ad-personalization** | personalized placement may load if provider/placement policy also allows |
| User revokes while vendor loads | cancel network/work; drop telemetry queue; remove ad iframe; disconnect observers; dispose exactly once |
| Provider blocked or times out | reserved ad region retains geometry; navigation and content continue normally |
| Authenticated invalidation of `product:sku-7` | only matching cache partition evicted; unauthorized invalidation denied |

## Minimal integration test plan

Set up a real local HTTP server with a trusted server-module test fixture and strict CSP, a browser with request interception, and fake providers counting `start/send/load/remove/dispose` calls. Test status/head/HTML and cache from HTTP responses; test browser identity/focus, hydration, provider network and cleanup with Playwright Chromium/Firefox/WebKit. Exercise invalid headers, JSON-LD payload and no-consent navigation. Treat zero optional vendor requests pre-consent as a hard pass/fail gate. This fixture cannot be automated until compiler server output, SSR/hydration and optional providers actually exist; implementation PRs own those tests.
