# B3 — Vite Plugin Production Build Performance Baseline

Stacked branch: `perf/b3-vite-build-benchmarks`, based on Proxy optimization `1654c820`.
This phase adds a real build benchmark **without changing the plugin runtime**.

## Workloads

- Real pinned Vite 6.4.5 production builds at 1, 8 and 24 independent TSX modules.
- Native ZaakiyJS signal-based event handlers, direct DOM generated code,
  utility-CSS extraction, JS/CSS emission and Zaakiy assets manifest.
- One warmup, four measured builds per workload, with complete raw samples,
  p50/p95, gzip JS/CSS totals and SHA-256 hashes over all output assets.
- Compare a frozen upstream commit and candidate in the same Node 22 runner.
  The output hashes and sizes must match. No speculative optimization is counted
  as a win on fewer than repeated independent measurements.

## Safety and correctness

Use the actual Vite plugin and TypeScript compiler rather than a mocked plugin
or proxy measurement. Test existing CSS/HMR/manifest, forbidden browser imports,
sourcemaps, reproducible production output and fail-closed SSR behavior.
Temporary benchmark sources are deleted after each workload.

This benchmark intentionally measures build wall time, not HMR update cost or
runtime browser interaction latency. HMR incremental invalidation, CSS utility
dedup and map generation will need separate instrumented fixtures before their
internals can be safely optimized.

## Next

Once baseline and candidate match, profile the 24-module result. Only implement
a plugin cache optimization if it preserves browser CSS, module graph
invalidations, source maps, production determinism and security restrictions.
