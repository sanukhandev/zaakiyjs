# Compat/Vite certification slice — 2026-11-17

Parent: PR #68 latest green head `da7ea3ed93f561dc2170041a253fb4b83302af90`.

## Accepted scope

- `zaakiyPlugin({ compat: {mode, targets} })` is a new build-only opt-in; no change to legacy `targetBrowsers` fail-closed compiler API.
- Review only `@zaakiyjs/compat` approved emitted-JS transforms, not arbitrary model code or untrusted polyfills.
- Browser entry chunks are analyzed before hashing; a deterministic `compat-manifest.json` is emitted. The build rejects unsupported features in strict mode and warns in auto mode.
- A transformation that cannot preserve requested source maps is refused. Do not lie about source map accuracy.
- Direct unsupported APIs remain unsupported; explicit scoped helpers are not global patches.
- Compiler IR v2 named slots now get scanned for `CompatFeature` nodes without pretending IR v3 works.

## Regression and benchmark gates

1. `pnpm install --frozen-lockfile`, `pnpm build`, `pnpm typecheck`, full Quality.
2. `pnpm --filter @zaakiyjs/compat test` including IR v2 detection and unsupported v3 refusal.
3. `pnpm --filter @zaakiyjs/vite-plugin test` including native supported strict targets, auto warnings, strict rejection, syntactic lowering, source-map refusal and stable manifest hashes.
4. Exact-head generated app, Chromium/Firefox/WebKit, CSP/a11y/heap, packed consumer and reproducibility, independent comparator. No unauthorized JS/CSS bytes in the default (compat disabled) app.
5. Retain frozen 1/8/24-module Vite profile and matching executable output hashes when compat disabled.
6. For enabled profiles, collect emitted JS/CSS gzip/brotli and manifest estimated shim bytes; record browser versions and compare only equivalent execution.

## Explicitly out of scope

State-preserving Vite HMR, full native JSX composition, general SSR hydration, CSS feature fallback, browser shims loaded by magic, runtime-based feature tests, third-party source graph semantics, latest browser support claims, full release certification. These retain separate G1–G7 acceptance gates in `docs/audits/partial-package-completion-plan.md`.

**No automatic merge or release.** Approval of a passing slice cannot close production certification blockers.
