# @zaakiyjs/ssr — P3 v1 foundation

**Status: implementation candidate, not production SSR/hydration.** This package implements the server response/request infrastructure and the frozen `zaakiy.render/1` protocol. The existing `@zaakiyjs/compiler` cannot emit trusted server-rendering modules and `@zaakiyjs/dom` cannot adopt hydrated markup. Consequently **reactive TSX SSR, full hydration, incremental component streaming and true ISR are blocked** until coordinated Compiler/Vite/DOM integration; none is simulated by an alternate JSX interpreter. Independent npm publication is not approved.

## Public entries

- `@zaakiyjs/ssr`: browser-safe schema IDs and TypeScript protocol declarations.
- `@zaakiyjs/ssr/node`: `createNodeServerAdapter`, `MemoryRenderCache`, `createCacheInvalidator`, `verifyTrustedManifest`, head/hydration serializers.
- `@zaakiyjs/ssr/build`: bounded `prerenderStatic`, strict manifest verification.
- `@zaakiyjs/ssr/client`: `inspectHydration` performs read-only browser markup/manifest checks; **does not attach listeners or claim hydration**.

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

## Implemented/blocked matrix

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

### Security and lifecycle

All requests use a fresh Core owner. Auth identity is supplied only through trusted host `resolvePrincipal`; route guards are never a substitute for backend authorization. Cache defaults to `no-store`, and public sharing requires an explicit policy. Private partitions require validated opaque keys; user-specific content must never enter public cache. Invalidation is an injected authorized service, not an open HTTP endpoint. Set CSP/security headers at the deployment boundary; `serializeHead` requires a nonce for JSON-LD and validates same-origin HTTPS links. Compiled modules must escape untrusted interpolations. No request-time compiler, DOM emulator, `eval`, dynamic remote imports or process-global owner.

`prerenderStatic` is build-only, accepts explicit public paths and typed async discovery; it rejects path traversal and duplicate mappings and deterministically writes `prerender-manifest.json`. It is not a CMS authorization engine; callers must supply already-published, public paths.

### Integration PR required

1. Create a separately reviewed Compiler server-output target and digest-bound module manifest, preserving IR v1 compatibility or negotiate a new version.
2. Create a compatible DOM hydration adoption ABI; preserve listeners/inputs/focus and verify Chromium/Firefox/WebKit.
3. Integrate server module build and artifacts into Vite, verify zero Node/compiler imports in browser.
4. Update workspace allowlist/frozen pnpm lockfile in a coordinated integration PR (package-only task does **not** own shared files).
5. Run full package/workspace CI, independent npm packing, offline consumer, memory/security/performance and real browser checks.

No quantified bundle-size/latency/memory improvement is claimed until measured. A passing static fixture must not be used to claim general SSR/hydration.


## Byte-verifiable server artifact build gate (hardening branch)

The Node-only `@zaakiyjs/ssr/build` subpath exports `buildVerifiedManifestV1(artifacts)` and `verifyTrustedArtifactBytes(manifest, bytesByModuleId)`. The first calculates a canonical `zaakiy.render-manifest/1` build ID from sorted route/module IDs and SHA-256 digests of actual compiled module bytes, never a caller's claimed hash. The second compares both the build ID and each module digest with deployment-controlled file contents, and rejects extra, missing or mutated artifacts.

Run both the bytes check and the existing `verifyTrustedManifest` runtime registration check before activating SSR. **This is a build integrity gate, not proof that a host module loader imported the checked bytes**. Deployments must bind an immutable registry to the exact attested artifacts. There is still no compiler TSX-to-server target or live DOM hydration adoption; issue #59 remains open.

The browser-only `@zaakiyjs/ssr/client` `inspectHydration` preflight now requires comment markers of the form `zaakiy-h:<markerId>:<templateDigest>`, validates digests, order, uniqueness, build/route identity and bounded cardinality, and fails closed on legacy ID-only markers. It inspects only; it neither hydrates nodes nor attaches listeners. Do not render these markers without an independently reviewed server compiler and hydration adapter.


### Byte-attested Node adapter

The `@zaakiyjs/ssr/node` subpath also exports `createByteAttestedNodeServerAdapter(options, bytesByModuleId)`. This factory validates the pinned manifest's SHA-256 build identity and each server module's exact artifact bytes *before* creating the request handler. It rejects missing/tampered bytes rather than serving through an unchecked factory. The original `createNodeServerAdapter` remains available for compatibility and does not imply byte attestation. The deployment must still guarantee that its immutable module registry loads the same verified bytes.
