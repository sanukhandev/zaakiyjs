# Production browser benchmark: ZaakiyJS vs React and frozen main

**Status: benchmark implementation; no numerical superiority or release claim until CI evidence is reviewed.**

This is a production Vite comparison of the **exact same application semantics** on three variants: React **19.2.4**, ZaakiyJS at immutable main baseline `f19b9f6a466de7f5b03dd085925c8d9092a87f85`, and the candidate PR commit. React and React DOM are installed only into the isolated benchmark reference app using a committed npm lockfile and `npm ci`; they are never dependencies of ZaakiyJS browser packages. The React fixture uses compiled JSX-runtime calls (`jsx`/`jsxs`), not dev-only React profiling instrumentation. Both apps build under the repository's pinned Vite 6.4.5 and Node 22.

The generated ZaakiyJS apps use the same TypeScript fixture copied into the frozen-main and PR worktrees. The fixture intentionally exercises only the supported **IR v1** subset so comparisons do not rely on newly added compiler features. Both render 1,000 keyed rows, a counter, a renameable row, and a conditional visible block. React uses `memo` and stable keyed rows; ZaakiyJS uses `signal`, `flushSync`, `Show`, `For`. List identity, correct text, row count and conditional behavior are checked before accepting *each sample*. Any mismatch or uncaught exception fails CI.

## Evidence and interpretation

`Production React Benchmark` builds both worktrees and the isolated React comparator, serves all three via Vite **preview**, and executes pinned Playwright in Chromium, Firefox and WebKit. Each browser/framework gets a fresh page, 10 warmups and 50 measured iterations per operation. `performance.now()` brackets only the synchronous update and settled DOM, excluding Playwright roundtrip; results include raw samples, p50, interpolated p95, mean, startup mark, optional uncontrolled JS heap (where browser reports it), exact browser versions, commit SHA and runner environment. Separate JSON computes per-production-asset raw, gzip and Brotli JS/CSS transfer sizes; it excludes source maps and build tooling.

`benchmark-artifacts/browser-results.json` and `benchmark-artifacts/bundle-sizes.json` are uploaded even when another job step fails. Never treat an absence of evidence, one browser, or a failed sample as passing. Run IDs and artifacts must match the **exact candidate head** before review. Compare candidate to both frozen main and React with the same browser, workload and build settings.

**Important limitations:** React compilation uses direct `jsx`/`jsxs` calls rather than an additional Babel/React Compiler optimization pipeline. The chosen components are intentionally narrow; these numbers do **not** generalize to routing, SSR, hydration, network, forms, enterprise apps or different browser hardware. `performance.memory` is non-standard and cannot certify leak freedom. A mounted-start mark measures JS-to-mount completion and should not be called LCP/FCP. Multi-machine baselines and independent end-user benchmarks still require work.

## Merge policy

This first implementation gates build completion and functional equivalence, not an arbitrary relative speed ranking. Once the **first stable successful CI results** have been inspected, add reviewed regression budgets based on multiple historical pinned-main runs (with rationale, platform/variance, p50/p95 and bundle-size tolerances). Do not silently infer production readiness, publish a ranking, weaken correctness assertions or set an uncalibrated threshold just to get green checks. The broader M6 memory/CPU/size and real-world app certification remains open.

To reproduce, follow `.github/workflows/production-benchmark.yml` using Node 22, pnpm 10.20.0, Vite 6.4.5, Python 3.12 and Playwright 1.64.1. Exact commands and baseline source revision are checked in to the workflow.
