# E1 — Project-scoped TypeScript diagnostics session

Parent PR: [#61](https://github.com/sanukhandev/zaakiyjs/pull/61).

## Measured reason

B8 showed 3,116.2 ms of 3,200.6 ms of 24-module staged compilation in TypeScript diagnostics. The historical implementation created a compiler host/program for every TSX transform, even when all modules shared the same declarations and compiler settings.

## Implementation

- A Node-only compilation session creates a TypeScript language service owned by one Vite plugin instance.
- Each transformed TSX source is supplied as a versioned in-memory script; semantic programs are reused by the language service.
- Imported source and type declarations use disk snapshots; watcher changes invalidate versions. Deleted files are removed as roots.
- Diagnostics are retrieved for the requested source file only; original custom JSX text checks remain sourced from the same current semantic program.
- Standalone compile(request) preserves the preexisting fresh-program behavior. No module/global singleton or browser runtime code was introduced.
- The build and dev server own disposal; no compiler/AI code is included in the browser runtime.
- Cache invalidation requires a separate session per independent project; source/config changes must be reflected before a dependent transform is accepted.

## Safety and acceptance

Require exact equality with standalone code, maps, manifests and diagnostic codes/spans for valid and invalid fixtures; changed/deleted imported types; two independent roots; and prohibited browser targets. Preserve every existing compiler, Vite, browser, release and security gate.

Compare this candidate with frozen B0–B5 on the existing **real Vite 1/8/24 TSX-module production-build benchmark**, including matching asset SHA-256 and compressed size. Verify at least three independent runs before claiming a stable speedup or imposing a numerical CI threshold.

**Status:** implementation candidate. Do not claim the measured target until CI benchmarks pass on the exact PR head. Reject and revert on stale type errors, map changes, cross-project state or measurable regressions.

## First implementation evidence

- Run https://github.com/sanukhandev/zaakiyjs/actions/runs/43081982596: 24 TSX modules, frozen 5064.3 ms p50 vs candidate 971.9 ms p50 (80.8% faster).
- Run https://github.com/sanukhandev/zaakiyjs/actions/runs/43082459609: 24 TSX modules, frozen 3225.1 ms p50 vs candidate 587.6 ms p50 (81.8% faster).
- Both comparisons verified matching production output hashes and compressed asset sizes. Compare each paired CI run internally, not absolute times across different hosts.
- Compiler session source restoration after module deletion initially failed; the external-import invalidation test caught it and the bug was corrected.
- Exact-head Quality and compiler stage profiling passed on commit 79516c6795a6ea00ea48918216e01cfa30d099c3.
- Follow-up Vite dev CSS invalidation requires final-head testing. These measurements prove build improvement, not browser INP or hydration.
