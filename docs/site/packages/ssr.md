---
title: "@zaakiyjs/ssr"
description: "P3 server-render infrastructure, trusted manifests, head serialization and hydration inspection"
sidebar_position: 19
---

# @zaakiyjs/ssr

Use the SSR foundation for trusted server modules and request-scoped rendering protocols, not general reactive TSX SSR yet.

> **Availability:** Source implementation in ZaakiyJS, not a verified published npm release. The package's manifest at the referenced revision uses `0.0.0`; use workspace tooling until independent publishing is approved.

## At a glance

- **Use it when:** Integrate only with deployment-controlled modules/manifest; compiler server output and client hydration adoption are not implemented.
- **Reference revision:** [9f6c6603c98c](https://github.com/sanukhandev/zaakiyjs/commit/9f6c6603c98ca566c2fed6fed34cc770f6a72960).

## Try it in the monorepo

```sh
pnpm --filter @zaakiyjs/ssr typecheck
pnpm --filter @zaakiyjs/ssr test
pnpm --filter @zaakiyjs/ssr build
```

## Feature usage: first working pattern

```ts
import { createNodeServerAdapter } from '@zaakiyjs/ssr/node';

// Both values must be produced/verified by trusted build/deploy code.
// `pinnedManifest` and `pinnedRegistry` are application supplied.
const handler = createNodeServerAdapter({
  origin: 'https://app.example.test',
  routes: [{ id: 'home', path: '/' }],
  policies: [{ version: 1, routeId: 'home', mode: 'ssr' }],
  manifest: pinnedManifest,
  modules: pinnedRegistry
});
const response = await handler.handle(new Request('https://app.example.test/'), {
  signal: new AbortController().signal
});
```

This example uses **trusted application-supplied placeholders**; it is not a drop-in SSR path for arbitrary TSX components.

## Usage and correctness guidelines

- `@zaakiyjs/ssr` root is protocol/types; server functions live under `/node`, build helpers under `/build`, read-only checks under `/client`.
- Hydration inspection alone checks markers; the optional `hydrateDataPage` API adopts only strictly validated data-bound SSR nodes and can attach explicitly declared client event handlers.
- Default response caching is no-store; public/shared caches require explicit authorization and partition policy.

## Public API index

Exported symbols detected in the package root `src/index.ts`. Platform-specific subpaths and structural contracts are explained in the detailed guide and package manifest.

- `CacheScopeV1`
- `HYDRATION_PROTOCOL`
- `HydrationEnvelopeV1`
- `DataHydrationNodeV1`
- `DataHydrationPlanV1`
- `DataHydrationElementV1`
- `DataHydrationTextV1`
- `DataHydrationSlotV1`
- `HydrationMismatchV1`
- `MANIFEST_PROTOCOL`
- `NodeServerAdapterV1`
- `RENDER_PROTOCOL`
- `RenderCacheInvalidatorV1`
- `RenderCachePolicyV1`
- `RenderHeadAdapterV1`
- `RenderHeadEntryV1`
- `RenderInvalidationRequestV1`
- `RenderModeV1`
- `RenderResponseV1`
- `RenderRoutePolicyV1`
- `ServerRequestContextV1`
- `TrustedModuleRegistration`
- `TrustedServerBuildManifestV1`
- `TrustedServerRenderModuleV1`

## Detailed feature guide

### Public entries

- `@zaakiyjs/ssr`: browser-safe schema IDs and TypeScript protocol declarations.
- `@zaakiyjs/ssr/node`: `createNodeServerAdapter`, `MemoryRenderCache`, `createCacheInvalidator`, `verifyTrustedManifest`, head/hydration serializers.
- `@zaakiyjs/ssr/build`: bounded `prerenderStatic`, strict manifest verification.
- `@zaakiyjs/ssr/client`: `inspectHydration` performs read-only preflight. Opt-in `hydrateDataPage` now verifies and adopts existing native nodes for the compiler's restricted data-bound SSR subset, with owner-scoped text/event bindings. It is not general TSX component hydration.

The Node bridge consumes deployment-controlled modules under `TrustedServerBuildManifestV1`. The `sourceDigest` is matched against the pinned registration metadata; verifying that it matches the **actual compiled module byte contents** must happen in the build pipeline (not yet available). Never populate the registry from an HTTP request, arbitrary dynamic import path, TSX expression source, or unverified source code. A handcrafted test module proves only infrastructure behavior, not compiler support.

```ts
import { createNodeServerAdapter } from "@zaakiyjs/ssr/node";
const handler = createNodeServerAdapter({
  origin: "https://app.example.test",
  routes: [{ id: "home", path: "/" }],
  policies: [{ version: 1, routeId: "home", mode: "ssr" }],
  manifest: pinnedManifest, // generated and signed/verified by future build adapter
  modules: pinnedRegistry // trusted immutable registry, not untrusted dynamic imports
});
const response = await handler.handle(new Request("https://app.example.test/"), {
  signal: new AbortController().signal
});
```

### Implemented/blocked matrix

| Capability | State |
| --- | --- |
| Request-scoped Core ownership and provider lookup | Foundation implemented |
| Public Router matcher, guards, redirects, loader execution | Foundation implemented; browser lazy PageView deferred |
| GET, HEAD, missing/denied statuses, trusted rendering, no-stack HTTP errors | Foundation implemented |
| Bounded public static HTML output and deterministic hashes | Foundation implemented for trusted modules |
| Hybrid TTL-scoped response cache, bounded single-flight, explicit partitioned invalidation | In-memory foundation, not distributed |
| AsyncIterable HTTP body streaming and cancellation/backpressure | Transport streaming only; no progressive component compiler |
| CSP-aware head serialization / JSON-LD escaping | Foundation implemented; requires app nonce policy |
| Versioned hydration serialization / read-only marker checks | Protocol validation only; DOM node adoption and browser matrix deferred |
| Reactive TSX server codegen + browser hydration | **Blocked — Compiler/DOM/Vite integration required** |
| Multi-node/conditional/keyed hydration + focus recovery | **Blocked — no runtime claiming ABI** |
| Deployment-neutral edge streaming | Deferred |

Hydration serialization requires explicit **leaf-level** public paths (for example `["page.title", "products[].sku"]`). A parent path does not authorize every nested field. Serialization does not imply hydration adoption is implemented.

#### Security and lifecycle

All requests use a fresh Core owner. Auth identity is supplied only through trusted host `resolvePrincipal`; route guards are never a substitute for backend authorization. Cache defaults to `no-store`, and public sharing requires an explicit policy. Private partitions require validated opaque keys; user-specific content must never enter public cache. Invalidation is an injected authorized service, not an open HTTP endpoint. Set CSP/security headers at the deployment boundary; `serializeHead` requires a nonce for JSON-LD and validates same-origin HTTPS links. Compiled modules must escape untrusted interpolations. No request-time compiler, DOM emulator, `eval`, dynamic remote imports or process-global owner.

`prerenderStatic` is build-only, accepts explicit public paths and typed async discovery; it rejects path traversal and duplicate mappings and deterministically writes `prerender-manifest.json`. It is not a CMS authorization engine; callers must supply already-published, public paths.

#### Cross-package implementation still required

1. Create a separately reviewed Compiler server-output target and digest-bound module manifest, preserving IR v1 compatibility or negotiate a new version.
2. Create a compatible DOM hydration adoption ABI; preserve listeners/inputs/focus and verify Chromium/Firefox/WebKit.
3. Integrate server module build and artifacts into Vite, verify zero Node/compiler imports in browser.
4. Run full package/workspace CI, independent npm packing, offline consumer, memory/security/performance and real browser checks.

No quantified bundle-size/latency/memory improvement is claimed until measured. A passing static fixture must not be used to claim general SSR/hydration.

## Integrate with neighboring packages

- [@zaakiyjs/router](./router.md)
- [@zaakiyjs/core](./core.md)
- [@zaakiyjs/compiler](./compiler.md)
- [@zaakiyjs/consent](./consent.md)

## Source and maintenance

- [Package README](https://github.com/sanukhandev/zaakiyjs/blob/9f6c6603c98ca566c2fed6fed34cc770f6a72960/packages/ssr/README.md)
- [Public source exports](https://github.com/sanukhandev/zaakiyjs/blob/9f6c6603c98ca566c2fed6fed34cc770f6a72960/packages/ssr/src/index.ts)
- [Package test cases](https://github.com/sanukhandev/zaakiyjs/tree/9f6c6603c98ca566c2fed6fed34cc770f6a72960/packages/ssr/test)
- Update this page when public APIs, runtime semantics or platform guarantees change.


### Data-bound native hydration (H0–H3 initial vertical slice)

This opt-in path is intentionally narrow. Build-time `compileDataServer({ ..., hydratable: true })` emits a `hydrationPlan` with stable IDs and comment markers. Deployment code must deliver a matching `HydrationEnvelopeV1` with the verified buildId and route. The browser imports `hydrateDataPage` from `@zaakiyjs/ssr/client` and supplies a trusted reactive read function and optional event handlers keyed by the compiler's element IDs. A matching page retains all server-rendered nodes and input state; owner disposal unregisters listeners and effects without removing server markup. Invalid structure, mismatched initial values, bad routes/builds or unexpected attributes fail before attachment.

This subset does **not** support compiler-generated JSX event expressions, arbitrary TSX components, keyed lists, conditional regions or automatic client bundle generation. Normal `compileDataServer` output remains byte-compatible when `hydratable` is disabled.

### H4 native interactive-region hydration (opt-in, experimental)

The Node-only compiler target `compileRegionServer` emits a deterministic
`zaakiy.region-hydration/2` plan and escaped server HTML from reviewed TSX IR.
Its restricted compiler subset supports one native root, static attributes,
own-data text paths, safe conditional/keyed regions and pure local component
calls with mapped data props. It rejects runtime TSX execution, unsafe URLs,
arbitrary JSX event expressions, nested dynamic regions and unsupported slots.

A verified deployment serves exact compiled module bytes with a matching
`HydrationEnvelopeV1` and trusted manifest. The browser imports
`hydrateRegionPage` from `@zaakiyjs/ssr/client`, supplies a trusted reactive
`read(path)` callback, and optionally provides explicit event callbacks keyed
to compiler-generated element IDs (for repeated rows, `id:key`). Strict
preflight checks every server node, marker, key, attribute and initial text
before constructing owners. Matching nodes retain identity, focus and live
input drafts. DOM/Signals handle post-adoption keyed ordering and branch
switching; owner disposal releases listeners/effects without removing
remaining SSR markup.

```ts
import { hydrateRegionPage } from "@zaakiyjs/ssr/client";

// plan and envelope come from the verified compiler/deployment artifacts.
// manifest must be byte-bound to the actual server module.
const handle = hydrateRegionPage(
  container, plan, envelope, manifest, "products", {
    read: path => trustedClientState.read(path)
  }
);
handle.dispose();
```

These values are intentionally application-supplied; no public state or
`read(path)` implementation is invented by the framework. H4 does not yet
cover arbitrary components, named slots, JSX event lowering, nested dynamic
regions or broad production browser certification. Do not treat this opt-in
source implementation as a published npm feature. See ADR 0015.
