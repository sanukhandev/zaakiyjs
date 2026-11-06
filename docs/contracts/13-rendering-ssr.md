# Contract 13 — rendering, server modules and hydration (P3 SSR v1)

- **Status:** Frozen **design** after P3-00 review; **not executable APIs**.
- **Owner:** proposed `@zaakiyjs/ssr`, with build integration owned by Compiler/Vite and route matching owned by Router.
- **Protocol:** `zaakiy.render/1`; render manifest `zaakiy.render-manifest/1`; hydration `zaakiy.hydration/1`.
- **Compatibility:** `IR_SCHEMA_VERSION = 1` and browser `@zaakiyjs/dom/compiler` ABI v1 **unchanged**.

## Verified starting point (main c4a07acceee5140867f7c65a3fbe95ca097e1822)

Compiler `compile()` emits browser DOM JavaScript (`js[]`, `css[]`, diagnostics, `manifest.domAbiVersion: 1`), not HTML/server modules. Vite plugin consumes that browser compiler; no server compiler target or hydration markers/claiming runtime are exported. DOM mounts fresh native nodes and owns root comment ranges; it does not hydrate existing HTML. Router exports `compileRoutes`/`matchRoutes`, typed guards/loaders, page adapters and generic `RouteDefinition.metadata`, but no server navigation pipeline or render-mode types. `@zaakiyjs/async` has a resource cache, **not** an SSR response cache/tag invalidator. No `packages/ssr` exists. All structures below are **future integration contracts**, not calls that work now.

## Public protocol (TypeScript illustration only)

~~~ts
type RenderModeV1 = "csr" | "ssr" | "ssg" | "hybrid";
type CacheScopeV1 = "public" | "tenant" | "user" | "no-store";
type HydrationMismatchV1 = "abort" | "replace-owned-boundary";
interface RenderRoutePolicyV1 {
  readonly version: 1;
  readonly routeId: string; // existing Router RouteDefinition.id
  readonly mode: RenderModeV1;
  readonly hydration?: { readonly enabled: boolean; readonly onMismatch: HydrationMismatchV1 };
  readonly cache?: RenderCachePolicyV1;
}
interface RenderCachePolicyV1 {
  readonly scope: CacheScopeV1;
  readonly ttlSeconds: number; // finite integer >=0; 0 = no cache
  readonly tags: readonly string[];
  readonly vary?: readonly string[]; // approved dimensions only
  readonly staleWhileRevalidateSeconds?: number;
}
interface TrustedServerBuildManifestV1 {
  readonly schema: "zaakiy.render-manifest/1";
  readonly buildId: string; // deterministic digest, no secrets
  readonly irVersion: 1;
  readonly domAbiVersion: 1;
  readonly routes: Readonly<Record<string, {
    readonly moduleId: string;
    readonly sourceDigest: string;
    readonly routeId: string;
  }>>;
}
interface ServerRequestContextV1 {
  readonly schema: "zaakiy.render/1";
  readonly request: {
    readonly url: URL;
    readonly method: "GET" | "HEAD";
    readonly headers: Readonly<Record<string, string>>;
    readonly signal: AbortSignal;
  };
  readonly route: { readonly id: string; readonly params: Readonly<Record<string, string>> };
  readonly owner: OwnerScope; // fresh Core root per request, never reused
  readonly services: NavigationServices; // request-bound provider facade
  readonly loaderData: unknown; // resolved by existing Router contract, with abort semantics
  readonly principal: { readonly scope: CacheScopeV1; readonly partitionKey?: string };
  readonly initialConsent?: ConsentSnapshotV1; // injected structural contract from Contract 15
}
interface TrustedServerRenderModuleV1 {
  readonly protocol: "zaakiy.render/1";
  render(context: ServerRequestContextV1): RenderResponseV1 | Promise<RenderResponseV1>;
}
interface RenderInvalidationRequestV1 {
  readonly version: 1;
  readonly tags: readonly string[];
  readonly scope: Exclude<CacheScopeV1, "no-store">;
  readonly partitionKey?: string; // required for tenant/user
  readonly principalId: string; // authenticated server-side, never exposed to client
  readonly issuedAt: string; // ISO 8601
  readonly idempotencyKey: string;
}
interface RenderCacheInvalidatorV1 {
  readonly version: 1;
  invalidate(request: RenderInvalidationRequestV1, signal: AbortSignal):
    Promise<{ readonly invalidatedCount: number }>;
}
interface RenderHeadEntryV1 {
  readonly tag: "title" | "meta" | "link" | "script-jsonld";
  readonly attributes?: Readonly<Record<string, string>>;
  readonly text?: string; // plain text or validated JSON-LD data, never raw HTML
}
interface RenderHeadAdapterV1 {
  readonly version: 1;
  resolve(input: { readonly routeId: string; readonly url: URL; readonly status: number;
    readonly loaderData: unknown }): Promise<readonly RenderHeadEntryV1[]> | readonly RenderHeadEntryV1[];
}
interface RenderResponseV1 {
  readonly version: 1;
  readonly status: number; // valid HTTP status
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string | AsyncIterable<Uint8Array>;
  readonly cache: { readonly scope: CacheScopeV1; readonly tags: readonly string[] };
  readonly hydration?: HydrationEnvelopeV1;
}
interface HydrationEnvelopeV1 {
  readonly schema: "zaakiy.hydration/1";
  readonly buildId: string;
  readonly domAbiVersion: 1;
  readonly routeId: string;
  readonly boundaries: readonly { readonly markerId: string; readonly templateDigest: string }[];
  readonly payload: unknown; // only allowlisted, safely serialized public data
}
interface NodeServerAdapterV1 {
  readonly version: 1;
  handle(request: Request, context: { readonly signal: AbortSignal }): Promise<Response>;
}
~~~

These are **reserved interface shapes**. `ConsentSnapshotV1` is the structurally compatible Contract 15 snapshot supplied by the host; SSR must not import the concrete Consent state engine. `OwnerScope` and `NavigationServices` refer to public Core/Router concepts; a future implementation must import their types only from public exports. `NodeServerAdapterV1` describes a Fetch Request/Response bridge on Node; no Node-specific dependency is introduced into browser modules. Route matching MUST reuse Router's public matcher; no second path grammar. Router's browser `PageView` is a `Node` and cannot be run on a server: generating a server render factory needs a distinct, reviewed compiler output target. Do not infer server support from `RouteDefinition.metadata`.

## Trusted build and request isolation

Only **allowlisted, build-generated** server modules enumerated in the pinned manifest may be loaded by a deployment adapter. Resolve module IDs against a deploy-time immutable table; verify digest/build identity, and reject unknown IDs or incompatible ABI/IR versions. Never compile user TSX at request time, evaluate serialized source, use `eval`/`new Function`, or load modules from request URLs. Do not import `@zaakiyjs/compiler` or Node filesystem from client hydration chunks.

Create a new root owner **for every HTTP request**, including simultaneous SSG/regeneration jobs with a synthetic request context. Bind loaders, services, auth, locale and consent snapshot to that root; explicit `runWithOwner` is synchronous (no patched Promise continuation). Abort on disconnect/timeout and dispose child owners/listeners/providers in `finally`, including streaming cancellation and render failures. No process-wide user/tenant signal or cached owner. No secret header/cookie/provider value in HTML or hydration JSON.

SSR/SSG/hybrid are **per route** opt-ins: CSR sends the normal shell; SSR renders on each request; SSG emits immutable predetermined build paths; hybrid serves scoped cached HTML with bounded authenticated regeneration. Never silently fall back to public cache for private data.

## Response and cache invariant

- Respond with real `200`, `301`/`302`/`307`/`308` (safe same-origin or explicitly approved external Location), `404`, `410`, `429` and `5xx` as appropriate; redirects happen before streaming any bytes. `HEAD` has headers/status but no body; `204`/`304` cannot emit a body.
- Status, cache policy, security headers and metadata settle before first streamed byte. Streaming is optional; adapters must support backpressure, cancellation, content-encoding boundaries and error handling after headers commit (terminate stream, log redacted failure; never rewrite a sent status). Escape text, attributes, JSON in script context and URL schemes; require CSP nonce/hash policy for script delivery. No raw HTML sink from user data.
- `scope: public` requires an explicit public-data decision; `tenant` and `user` require validated opaque partition keys and private cache storage (never shared CDN/public HTML). `no-store` forbids persistence. Cache key includes buildId, routeId, normalized path/query, locale, relevant vary headers, authorization partition and relevant content revision. Exclude volatile tracking IDs. Permission-dependent HTML is not shareable absent a privacy-safe vary strategy.
- `ttlSeconds` controls freshness, not permission to extend access. Tags are bounded canonical identifiers (e.g. `product:sku-123`), with tenant namespace where applicable. An authenticated invalidation adapter accepts {version:1, tags, scope, principal, issuedAt, idempotencyKey} and checks entitlement, deduplicates requests, and invalidates only matching partitions. Regeneration is atomic, concurrency-bounded and single-flight per key. An in-memory per-process cache is not a distributed invalidation guarantee.
- Cached responses must never contain request-specific consent state, user identity or personalized advertising unless correctly partitioned and protected. Default to `no-store` when classification is uncertain.

## Hydration and mismatch policy

A deterministic marker ID is derived from `buildId + routeId + compiler-stable node ID + keyed path`, with escaping and duplicate rejection; it must not include user content, secret identifiers or nondeterministic clock/random sources. The client validates matching manifest/build/ABI, marker uniqueness/order, route identity and template digest before adopting existing owned nodes. Hydration payload uses an allowlisted JSON serializer with depth/size caps, no executable prototypes/functions, no secret/internal fields; escape `<`, `>`, `&`, U+2028/U+2029 and `</script>` against script breakout.

Default `onMismatch: "abort"`: fail with safe diagnostics and do not attach duplicate listeners. `replace-owned-boundary` is explicit per route, restricted to the matching owner range, never the whole document; save/restore focus, selection and user-edited form values when compatible. Dispose partially adopted effects/listeners and report a redacted mismatch code. Nested keyed fragment hydration is deferred until separately verified; DOM root comment markers are **not** yet hydration markers.

## Acceptance gates and deferrals

Required future verification: server-output compiler/manifest deterministic golden cases; cross-request owner isolation and credential leak test; HTML/JSON-LD escaping, CSP/XSS, streaming abort/backpressure, status before flush, 404/410/redirects, 2-tenant cache/invalidations, revalidation stampede, hydration focus/inputs and wrong-build mismatch in Chromium/Firefox/WebKit. Browser bundles must contain zero server compiler, proxy or Node imports.

**Deferred:** actual server compiler transform, runtime implementation, edge adapters, incremental streaming/Suspense, streaming nested hydration, ISR coordinator, CMS webhook integration and cache storage providers. Each requires its own implementation PR and tests. Neither `IR_SCHEMA_VERSION` nor DOM ABI v1 changes in P3-00.
