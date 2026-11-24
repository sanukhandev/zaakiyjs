# H4-E production hydration benchmarking — evidence contract

**Status:** ZaakiyJS H4 single-framework diagnostic implemented in the
H6 Chromium/Firefox/WebKit Playwright fixture. **Matched React/Vue/Angular
hydration comparisons are not yet implemented or validated. Do not publish
cross-framework rankings or infer performance superiority.**

## Committed evidence now available

The `H6 Native Data Hydration Browser` workflow builds an attested
`compileRegionServer()` module and an independently produced Vite
`hydrateRegionPage` browser bundle. It checks existing-node adoption,
focus/input retention, keyed reorder, JSX event capture/disposal, CSP,
escaped server text and public-state initialization. It also emits 20 raw
timing samples per browser for 100 synchronously settled reactive text
updates each, with diagnostic p50/p95 values in
`benchmark-artifacts/hydration-browser-evidence.json`.

These samples are **ZaakiyJS-only reactive-update measurements**. They are
neither initial hydration latency nor LCP/INP, and cannot be compared to
React/Vue/Angular startup times.

## Mandatory next comparison (separate release gate)

Use one fixed production-equivalent application, with 100/1,000/10,000
pre-rendered keyed rows, two nested component scopes, 2-level keyed rows,
one conditional, a controlled counter and one independent input draft.
All frameworks must render identical pre-hydration HTML, initialize
semantically equivalent state, adopt matching native DOM, attach one
click action, support immutable reorder/remove/insert, and clean all
listeners/owners on disposal. Fail any run where semantics differ.

- React: isolated pinned `react`/`react-dom` production build,
  `renderToString` and `hydrateRoot`, not `createRoot`.
- Vue: isolated pinned `vue` production build,
  `createSSRApp` server/client hydration; no dev instrumentation.
- Angular: isolated pinned Angular SSR/client-hydration toolchain using
  `provideClientHydration` under a verified production build.
- ZaakiyJS: exact PR head with opt-in H4 v2 compiler SSR/hydration, no
  compiler/AI in browser. A failed unsupported fixture must remain failed,
  not silently replaced by `mount()`.

Pin each compiler/toolchain dependency and lockfile. Build all artifacts
offline from committed dependency locks after initial install, publish
per-browser versions and exact commit hashes, and run on identical hardware
and production configuration. Keep bundle transfer and runtime execution
cost separate; no dev-server comparisons.

For each browser and framework, record 10+ warmups and at least 50 measured
fresh-page hydration samples (and 50 reactive updates), randomized variant
order, DOM mutations, p50/p95/p99, bootstrap bytes (raw/gzip/Brotli),
permanent heap growth after 100 mount/dispose cycles, focus/input identity,
per-boundary listener counts and raw samples. Hydration timing must start
after SSR HTML parsing and end after framework hydration settles; report
script fetch/evaluation separately. Use matched output/state and keyboard
checks as mandatory validity gates.

Until the isolated Vue/Angular/React SSR references and lockfiles exist
and their evidence is generated on the **same final head**, E6 is **open**.
The existing `Production React Benchmark` measures interactive client
updates, not equivalent hydration, and must not be relabeled.
