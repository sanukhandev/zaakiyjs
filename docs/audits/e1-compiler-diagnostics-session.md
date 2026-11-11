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
