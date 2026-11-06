# P3 — dependency and integration matrix (design freeze v1)

**Status:** Contract-only review artifact. Protocol IDs: `zaakiy.render/1`, `zaakiy.render-manifest/1`, `zaakiy.hydration/1`, `zaakiy.seo/1`, `zaakiy.sitemap/1`, `zaakiy.consent/1`, `zaakiy.analytics/1` and `zaakiy.ads/1`.

## Package/environment/ownership matrix

| Consumer | Environment / future entry | Allowed dependencies | Disallowed imports and implicit behavior | Responsible outputs |
| --- | --- | --- | --- | --- |
| `ssr` server | Node `/node` only | public `core` owners, `router` matching/loader contract, vetted trusted build artifacts; injected head adapter | browser DOM calls, duplicated Router engine, runtime TSX compiler, `ai`, vendor Ads/Analytics | request scope, HTTP status/headers/stream, safe HTML, cache, hydration manifest |
| `ssr` client | browser `/client` only | public `core`, browser `dom` ABI | `node:` APIs, server entry, `proxy`, `compiler`, `ai`, SSR cache internals | bound hydration owner, marker verification/mismatch cleanup |
| `ssr` build integration | Node build adapter | `compiler`, `vite-plugin` public build exports, deterministic manifests | browser inclusion, request-time source evaluation | trusted server module/asset manifest |
| `seo` | pure JS / static build / optional browser client | no mandatory Zaakiy runtime; app-supplied site/route data and origin | SSR package, Router implementation internals, raw HTML insertion | pure metadata, sitemap entries, sanitized head source data |
| `consent` | browser / SSR request snapshot | policy/CMP/storage adapters supplied by host, optional Core owner | Analytics/Ads imports, legal rule hardcoding, global authorization state | permission capability, monotonic snapshot, revoke events |
| `analytics` | optional browser + explicit server adapter | injected `ConsentCapabilityV1` shape, browser APIs once permitted, optional Core ownership | Ads, Consent implementation required, Router/History monkey patches, Core auto import | event/conversion/pageview/vitals records, bounded delivery |
| `ads` | optional browser | injected `ConsentCapabilityV1` shape, explicit app provider, DOM owner | Analytics, Consent implementation required, automatic third-party scripts, Core auto import | reserved slots, provider state, load/abort/teardown |
| Core/Signals/DOM | browser runtime | existing foundational deps | any P3 package required, Node, Proxy, Compiler, AI | current owner/reactive/DOM contract |
| Router | client matcher/navigation | current Core/Signals public deps | automatic SSR/SEO/Ads/Analytics import | routes/guards/loaders/navigations |
| Proxy | server-only | approved server security adapters | client import, treatment as SSR route engine | existing secure upstream proxy |

`@zaakiyjs/styles` remains build-only; it is not an ad layout engine. CSS can reserve slot geometry at build time. `@zaakiyjs/async` resource cache is **not** a response cache. `@zaakiyjs/http` is a typed Fetch client, not an SSR server adapter.

## Integration handshake (protocol only)

| Producer -> consumer | Transport or adapter | Required checks | Failure behavior |
| --- | --- | --- | --- |
| Compiler/Vite -> SSR server | signed/deployed allowlist of `TrustedServerBuildManifestV1` modules | exact buildId, IR=1, DOM ABI=1, approved module ID/digest | refuse rendering/serve safe error; no runtime compile |
| Router -> SSR | public `compileRoutes` / `matchRoutes` and guarded/authorized loader results | matching route ID, abort, owner isolation, status/redirect | correct 404/403/3xx; no user data leak |
| SEO -> SSR | public `RenderHeadAdapterV1` returning `RenderHeadEntryV1` | safe URL/attrs, accurate HTTP status, escaping | omit invalid tags / fail safe, no injected HTML |
| SSR -> Client hydration | `HydrationEnvelopeV1` and stable owned markers | exact schema/buildId/route/template, no duplicate marker, safe JSON | abort adoption or explicit owned-boundary recovery |
| Server/CMP -> Consent | `ConsentSnapshotV1` from policy/storage adapter | schema, region policy, monotonic revision, trusted request scope | optional grants unknown/false |
| Consent -> Analytics | injected `ConsentCapabilityV1` `can("analytics")` and subscription | check before load, enqueue, flush; recheck on change | no send; abort, clear, dispose |
| Consent -> Ads | injected `ConsentCapabilityV1` and union of all slot and provider required purposes (check every one) | `advertising` + optional `ad-personalization` before any vendor call | reserved placeholder only; teardown on revoke |
| Router -> Analytics | app adapter listening only to committed navigation | sanitized route ID/path, opt-in analytics consent | no event for attempted/blocked navigation |
| Ads -> Analytics | **no automatic integration** | if app explicitly bridges, both independent policies must allow | no implicit measurement |

## Compatibility checks and enforcement (planned implementation gates)

1. **Static graph:** no cycles; no browser-transitive `node:`, `compiler`, `proxy`, `ai`, private `/src` imports; external package dependencies/version ranges review. Declared optional imports stay optional.
2. **Bundle:** minimal Core-only app contains 0 P3 vendor modules/requests; SSR Node output contains no browser-only DOM execution; SSR hydration client contains no Node/proxy/TS AST. Build with/without optional packages and compare module graph.
3. **Contract shapes:** test schema/version rejects, purpose names and states, HTTP result and status metadata precedence, marker determinism, no unchecked head URLs.
4. **Runtime behavior:** request user/tenant isolation, cache invalidation authentication and stampede handling, input-focus hydration recovery, consent unknown/revoke/cross-policy, blocked vendor, CLS-safe slots, observer/iframe cleanup, no unsolicited network traffic.
5. **Current repo:** source-only contract baseline; no P3 runtime packages exist. Do not report these future gates as passing because M1/P2 browser tests pass.

## Work ownership and merge ordering

P3-00 merges docs first. Then five **parallel** agents branch from the verified `P3_BASE_SHA`, each owns its own `packages/{name}` implementation, independent changeset, tests and README; interop tests use structural adapters without modifying others' private files. Integration PRs subsequently compose SEO head + SSR, Router + analytics pageview, and consent + ads/analytics. No agent can redefine frozen protocol version without a coordinated ADR.
