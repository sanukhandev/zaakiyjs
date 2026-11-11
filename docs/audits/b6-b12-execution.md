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
