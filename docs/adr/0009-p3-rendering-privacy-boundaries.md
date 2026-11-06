# ADR 0009 — P3 server rendering, SEO, consent, analytics and ads contracts

- **Status:** Proposed; becomes an accepted design baseline **only when P3-00 PR is reviewed, checks pass and it is merged**.
- **Date:** 2026-11-06
- **Owners:** SSR, SEO, Consent, Analytics and Ads proposed package maintainers.
- **References:** [rendering](../contracts/13-rendering-ssr.md), [SEO](../contracts/14-seo.md), [consent](../contracts/15-consent.md), [analytics](../contracts/16-analytics.md), [ads](../contracts/17-ads.md), [matrix](../contracts/p3-dependency-integration-matrix.md), [fixture](../contracts/p3-page-ownership-example.md).
- **Extends:** ADRs 0002, 0004–0008. **No change** to IR v1 or DOM ABI v1.

## Context

Core/Signals/DOM/Compiler/Vite, Router and supporting network packages have working implementation subsets, but **there is no server rendering output target, hydration runtime, SEO serializer, tagged page cache, Consent/Analytics/Ads package or vendor adapter** on the P3 base. Existing Router `metadata: Record<string, unknown>` is not a metadata policy; the DOM mount's comment anchors are not hydration IDs. Without a freeze, five parallel agents could produce incompatible contracts or inadvertently pull a server/compiler/analytics vendor SDK into the browser core.

## Decisions

1. **Independent ownership:** SSR owns server response, request-scoped owners, safe hydration and render cache; Compiler/Vite own generation of *trusted build-time* server artifacts; Router alone owns route matching/guard-loader semantics. SSR may call only public Core/Router APIs and reviewed server-output adapters. It cannot execute client `PageView.node` on Node. No replacement route matcher.
2. **Typed but decoupled metadata:** SEO owns pure site/route metadata, structured JSON-LD and sitemap discovery, independent of SSR. A public, structural `RenderHeadAdapterV1` converts SEO resolution to a renderer-safe head entry representation. No private-source imports, raw HTML or circular SSR↔SEO dependencies.
3. **Consent before optional work:** Consent owns versioned snapshot/purpose checks, policy/CMP/storage adapters and notifications. The capability can be injected structurally into Analytics and Ads, including independently compiled mocks. `unknown`, `denied` and `revoked` prohibit optional collection/provider initialization. Essential operations do not automatically authorize optional use.
4. **Separate vendor adapters:** Analytics owns measurement, conversions/pageviews and Web Vitals with bounded delivery. Ads owns placements, slot sizing, provider loading and teardown. Neither imports the other, and neither is imported by Core, Router or SSR by default. Ad-provider telemetry never implicitly grants Analytics permissions.
5. **Browser/server partitions:** Browser hydration lives behind an explicit browser-safe export (future `@zaakiyjs/ssr/client`) and cannot transitively import Node, Proxy, Compiler or AI. Node server entry (future `@zaakiyjs/ssr/node`) may load vetted build manifests and server modules. Build-only integration is isolated (future `@zaakiyjs/ssr/build` or Vite adapter). Optional packages must tree-shake to zero bytes from a bare Core app, verified in actual production bundles.
6. **Compatibility and trust:** Frozen schema IDs and v1 versions govern cross-agent boundaries; unknown version => reject, not guess. Generated HTML must be escaped, CSP-compatible and status-correct. Hydration must not double-attach listeners, leak user data or replace unrelated DOM. Cache defaults to no-store absent a proven authorization scope; tags and revalidation must be authenticated and partitioned. Prohibit source evaluation, global Promise/Zone patches, process-global owner state and third-party code before consent.

## Dependency arrows (consumer -> allowed dependency)

~~~text
[server application] -> SSR server -> Router(public matcher), Core(public owner)
[build adapter] -> Compiler, Vite, trusted SSR build-manifest contract
[server application] -> SEO resolver -> pure values
[server application] -> SEO-to-RenderHeadAdapterV1 -> SSR public adapter
[application] -> Consent capability <- Analytics
[application] -> Consent capability <- Ads
[application] -> Analytics provider (optional)
[application] -> Ads provider (optional)
[client application] -> SSR client hydration (optional) -> Core, DOM (browser ABI)
~~~

These arrows describe **reserved future dependencies**, not existing manifests. SEO must not require SSR; Consent must not import Ads/Analytics; Analytics and Ads must not require each other; Core, Signals, DOM and Router must never require any of the five. A type-only reference from consumer to the public Consent protocol is acceptable, but concrete Consent is injected at application composition time.

## Compatibility and non-goals

P3-00 **only adds Markdown documentation**. No `packages/{ssr,seo,consent,analytics,ads}` directory, stub API, TypeScript runtime import, changeset, generated asset or new framework integration is authorized. A separate compiler/server-output ADR, compatibility negotiation and regression suites are required before runtime support claims. Existing `IR_SCHEMA_VERSION = 1`, `domAbiVersion = 1`, `@zaakiyjs/dom/compiler` ownership and Router behavior remain frozen.

Deferred: streaming incremental hydration, Suspense/async components, nested keyed SSR adoption, edge runtimes, global cache providers, CMS invalidation implementations, automatic search-engine submission, baked-in jurisdiction rules, named ad providers, tracking SDKs, vendor consent certification. Each needs implementation/validation and documented per-package version intent.

## Decision review and rollout

- Review the five contracts **together** for shared shape/version consistency and fail-closed behavior, then verify the dependency matrix and page-ownership fixture.
- Check that the PR changes only docs, does not alter package manifests/IR/ABI, and passes applicable repository CI. Contract-only PR carries **no changeset**; no published package modified.
- After a verified merge, capture **the main merge/squash commit SHA**, call it `P3_BASE_SHA`, and require all five independent agent branches to start from that exact commit. The pre-merge feature-head SHA is **not** the base.
- Future implementation PRs must include actual browser/Node pack-import smoke, real production-bundle boundary checks, consent provider-blocking network tests, auth-isolated cache/hydration tests and verified release metadata. Unsupported contracts must fail closed.
