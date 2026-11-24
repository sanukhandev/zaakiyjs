# ZaakiyJS B6–B12 performance execution ledger

Status: **in progress; no production certification or release authorization**.
Review boundary: PR #61 (feat/production-hardening-integration); keep this as the only open PR.
Frozen references: original main f19b9f6a466de7f5b03dd085925c8d9092a87f85; pre-optimization hardening 04f453c18b31c7f900d77b037b0548f8888826f1; first B0–B5 consolidated head 54b130ed57632be777e264ba255cef8cb8e5b2c1.

## B6 — Baselines and profiling

- [x] Add forced-GC Node owner/effect lifecycle benchmark with hard assertions on disposal and post-disposal subscription activity.
- [x] Pair frozen hardening and candidate in a CI workflow; archive raw times, heap checkpoints, and a comparison report.
- [ ] Review workflow results for the final head and repeat runs on independent hardware.
- [ ] Measure browser retained heap, 24-module cold/warm builds, HMR module/CSS invalidation and realistic LCP/INP/CLS.

## B7 — DOM, Signals, Core, Async

- [ ] Profile 10,000-row Firefox reversal (historical report p50 approximately 432 ms) with the existing production fixture.
- [ ] Profile dynamic signal dependencies, scheduling, mounted owner lifecycle and cancellation before changing internals.
- [ ] Preserve LIS sparse moves, WebKit-safe high-churn moves, exact DOM identity, focus and cleanup.
- [ ] Benchmark optional virtualization as an independent application workload, not a replacement for full-DOM reversal results.

## B8 — Compiler, Vite and Styles

- [ ] Attribute cold build time among AST, type diagnostics, IR, output, CSS and bundling.
- [ ] Add warm-HMR and selective CSS graph invalidation fixtures; preserve full reload until an owner-safe HMR protocol is reviewed.
- [ ] Optimize only with complete cache fingerprints, source maps, repeatable hashes and original evaluation-order guarantees.
- [ ] Initial investigation target: 20% faster 24-module build; only claim improvement when repeatedly measured.

## B9 — Integrated app responsiveness

- [ ] Benchmark complex CRUD forms, state selectors, async validators, route loaders, keyboard focus and reduced motion.
- [ ] Require complete real-browser interaction p50/p95, no memory or accessibility regression.

## B10 — SSR and networking

- [ ] Implement and verify compiler-driven SSR plus same-native-node hydration under issue #59 before performance certification.
- [ ] Measure cancellation, tenant isolation, cache/streaming and local approved upstream concurrency without relaxing SSRF/auth.

## B11 — Cross-framework and 23-package evidence

- [ ] Preserve equivalent React 19.2.4 and frozen ZaakiyJS comparisons.
- [ ] Add Angular/Vue comparable production workloads with pinned versions and matched semantics.
- [ ] Publish raw sample distributions, browser versions, heap/GC, DOM mutations, JS/CSS compressed sizes and workload limitations.

## B12 — Acceptance

- [ ] Final-head Quality, full Vitest, compiler golden, all three browsers, security/privacy/accessibility, reproducibility and release evidence.
- [ ] Resolve or explicitly disposition issues #24, #37 and #59 with reviewed acceptance evidence.
- [ ] Record Changesets or no-release decisions; never bypass a correctness gate for a benchmark, merge PR #61 into main, or publish implicitly.

## B6 benchmark interpretation

Each test cycle creates 200 child owners and owned signal effects, updates the signals once, disposes the owner graph, changes the former signals again, and asserts no effects run after teardown. It records 160 measured cycles across eight forced-GC heap checkpoints and four warmups. Exact cleanup and post-disposal assertions are blocking; Node heap slope and cycle p50/p95 are **diagnostic**.

Positive heap growth alone does not prove a leak; flat heap readings cannot certify absence of leaks in browsers. Independent runs and real-browser retained-heap profiling are prerequisites for a production memory claim.

## Verified B6–B8 execution evidence (November 11, 2026)

### B6 memory lifecycle baseline — accepted instrumentation

- Workflow: https://github.com/sanukhandev/zaakiyjs/actions/runs/43025139796 — passed.
- Frozen hardening / candidate owner-effect cycle p50: 0.623 / 0.746 ms; p95: 1.969 / 1.882 ms.
- After-GC Node heap delta: +137,416 / +149,856 bytes, single shared-host diagnostic.
- Both variants executed 32,800 scoped cleanup callbacks, with **zero post-disposal effects**.
- No runtime memory optimization or browser leak certification follows from this evidence.

### B7 direct-signal allocation experiment — rejected

- Baseline comparison: https://github.com/sanukhandev/zaakiyjs/actions/runs/43027087735.
- Initial direct-signal p50: 13.66 -> 12.19 ms (10.8% faster); computed p50: 19.08 -> 19.94 ms (4.5% slower).
- Independent rerun: direct 13.53 -> 12.35 ms; computed 18.84 -> 19.59 ms.
- Snapshot-reuse alternative: https://github.com/sanukhandev/zaakiyjs/actions/runs/43027707025 — direct 13.49 -> 12.31 ms; computed 19.50 -> 21.41 ms (9.8% slower).
- Both direct and computed behavior passed semantic tests, but performance was not regression-free. The production Signals implementation was restored to frozen B0–B5 source. Keep the standalone benchmark and regression tests; no Signals patch release is proposed.

### B8 build and compiler phase attribution — accepted instrumentation

- Production Vite phase run: https://github.com/sanukhandev/zaakiyjs/actions/runs/43025874154 — passed.
- 24-module candidate total p50 3,472.7 ms, including 3,395.8 ms in Zaakiy TSX transforms; CSS/manifest generateBundle approximately 1.1 ms. Production output hashes and gzip sizes matched frozen reference.
- Isolated compiler stage run: https://github.com/sanukhandev/zaakiyjs/actions/runs/43027409688 — passed.
- 24-module compiler staged p50 3,200.6 ms: analysis 6.5 ms, IR optimization 1.2 ms, **TypeScript diagnostics 3,116.2 ms**, JS/sourcemap emission 85.9 ms.
- Type diagnostics account for approximately 97.4% of the staged compiler time in this fixture. Existing code builds a TypeScript Program independently per requested module.
- The next candidate is an explicitly scoped type-diagnostics session/cache, **not** a global process cache: prove changed-input invalidation, imported dependency changes, TS/compiler option changes, source maps, program lifetime, deterministic output, diagnostics and concurrent workspace isolation before implementation.
- No claimed compiler speedup yet. Repeated independent runs and full output/correctness gates are required before accepting a caching implementation.

**Gate status:** B6 and B8 measurement infrastructure landed. The B7 production experiment was reverted. B9–B12 and browser-retained-memory certification are pending, and PR #61 remains a draft.
