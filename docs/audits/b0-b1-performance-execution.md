# B0–B1 package performance expansion

Branch: `perf/b0-b1-package-benchmarks`. Frozen comparison: [PR #62 head](https://github.com/sanukhandev/zaakiyjs/commit/62800aad999beafa22d0bb5b884ee28575e7ffc5). Do not modify or merge PR #62 while this assessment is in progress.

## Implemented vertical slices

- **@zaakiyjs/forms**: form-level issues are partitioned by registered field path once, replacing O(fields × issues) filtering. Duplicates, original ordering, unregistered paths and global issues remain semantically unchanged; 200-field correctness test.
- **@zaakiyjs/analytics**: growing batches use an exact incremental UTF-8 byte total instead of reserializing the entire JSON prefix. The wire shape remains `{"events":[...]}`; bounded batch and ordering tested.
- **B1 metrics**: public API form validation for 30/100/300/700 fields and analytics flush for 50/200/400 sanitized events. 20 recorded samples per size and 3 warmups, from the same Node 22 runner and identical fixture against frozen PR #62. No real HTTP transport, no browser and no claims of Core Web Vitals.
- **B0 additional baselines**: controlled Async AbortSignal composition, HTTP mock-fetch JSON decoding, Compat TypeScript AST feature planning and SEO metadata rendering. These packages are intentionally unchanged; metrics are baselines, not speedups.
- **Coverage**: existing direct workloads for Signals/Core/DOM/Compiler/Styles/Store/Router (7); Forms and Analytics (2); Async/HTTP/Compat/SEO (4) = 13/23 packages with a direct isolated performance scenario. All 23 still have emitted package size inventory.
- **Still needing direct performance workloads**: Ads, CLI, Consent, Motion, Proxy, SSR, Templates, UI, UI Primitives, Vite Plugin. Passing tests or compressed file sizes are not substitutes for workload-level timing.

## Before accepting optimizations

1. Complete lint, TypeScript strict check, Vitest, E2E Chromium/Firefox/WebKit and release hardening on the exact commit; source security/consent/ownership behavior cannot change to game performance.
2. Run immutable before/after benchmarks on the same GitHub job. Keep raw samples (p50/p95), workload sizes and environment metadata; no fabricated or extrapolated metrics.
3. Treat one noisy hosted-CI run as directional; only permit merge-level performance assertions after repeated independent runs and correctness-based thresholds.
4. Audit gzip/brotli and app consumer bundle impacts. Runtime API and source maps stay compatible; no browser AI dependency, no unsafe sinks.
5. Keep PR #62 as an open draft. Stack a separate review PR only after B0/B1 tests and benchmark comparisons succeed; do not merge or publish packages implicitly.

## Next staged implementation candidates (not yet done)

- **P0 — Proxy**: benchmark 10/100/1000 compiled routes and 1k RPS with a local approved upstream, then consider safe route-prefix indexing while preserving method-specific 405 behavior, SSRF protections and diagnostic categories.
- **P0 — Vite Plugin**: quantify cold/warm build, 1/100/1000-module CSS invalidation; optimize only if incremental cache invalidation can be proven source-map and determinism safe.
- **P1 — Firefox DOM reverse**: profile native batch moves and high-churn fragments, preserving the WebKit-safe implementation. Do not reuse the rejected `Range.extractContents` experiment.
- **P1 — Store/Forms/Router integration**: large nested CRUD app with realistic async validations, focus retention and cancellation.
- **P2 — UI/Motion/Consent/Ads/SSR/SEO/Templates/CLI**: package-specific end-to-end and security-equivalent reference workloads; compare React only for truly equivalent application rendering behavior.

The existing React 19.2.4 / frozen main / frozen hardening / candidate production UI benchmark remains the direct rendering reference. HTTP, Analytics and Proxy must not be falsely compared against a React UI runtime without equivalent functionality.
