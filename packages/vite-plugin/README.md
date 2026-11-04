# @zaakiyjs/vite-plugin

Build-time Vite bridge for the ZaakiyJS native-DOM compiler and atomic-style engine.

**Status: draft integration.** The M0 `@zaakiyjs/compiler`, `@zaakiyjs/styles`, and native-DOM packages are types-only on the branch's baseline. This package exports a working Vite plugin *adapter*, but a successful Zaakiy TSX application build is **not yet possible** and is **not claimed**. Missing executable exports fail loudly, with no JSX/esbuild/Tailwind fallback.

## Usage

```ts
// vite.config.ts — once compiler, styles and DOM implementations have landed
import { defineConfig } from "vite";
import { zaakiyPlugin } from "@zaakiyjs/vite-plugin/plugin";

export default defineConfig({
  plugins: [
    zaakiyPlugin({
      configFile: "zaakiy.config.ts",
      browserTargets: ["chrome >= 120", "firefox >= 120"]
    })
  ],
  build: { sourcemap: true }
});
```

A static TSX component imports `virtual:zaakiy-styles.css` automatically from the generated JS. In development the virtual module serves the current aggregate stylesheet. In HTML production builds a deterministic `assets/zaakiy-styles.css` is emitted, linked into HTML, and enumerated in `zaakiy-assets.json` (schema version 1). Non-HTML/library consumers must add the emitted CSS file to their distribution manually. A configured brand or safelist can generate CSS even when no TSX files are transformed, once the styles engine is available.

For this M0-based draft, the executable factory is exposed via the package `./plugin` subpath. The M0 root export surface stays unchanged to preserve existing cross-package contracts. Root-level re-export requires a coordinated M1 contract/test update.

## Public configuration

- `configFile`: optional path to a trusted `StyleConfig` default export. The default is an empty `brand` rather than executing arbitrary project config during a build. Configuration is loaded by Vite in Node, never embedded into client JS. On change, development fully reloads.
- `include` / `exclude`: standard Vite/Rollup filter patterns; only `.tsx` and `.mtsx` files are eligible by default. Ordinary JS/TS is delegated to Vite.
- `browserTargets`: forwarded to the native TSX compiler and included in the compilation cache key.
- `cssFileName`: optional safe CSS asset path under `assets/`, default `assets/zaakiy-styles.css`. Directory traversal and URL-like values are rejected.
- `cssVirtualId`: frozen to `virtual:zaakiy-styles.css`; other values fail rather than creating incompatible public imports.

No mandatory Tailwind, React Fast Refresh, or browser-side compiler is included. Unsupported SSR transform (explicitly rejected, never delegated to another JSX compiler), arbitrary custom CSS output names and per-entry CSS splitting are not yet supported.

## Integration contract and blocking prerequisites

The compiler's *result* and the styles *result* are frozen in M0, but the executable export functions and token transport are not. Until the coordinating integration ADR freezes them, this adapter requires:

- `@zaakiyjs/compiler.compile(request: CompileRequest): CompileResult | Promise<CompileResult>` returning one JS asset per transformed TSX module, IR version 1, a valid source map when requested, and diagnostics with original TSX spans.
- `@zaakiyjs/styles.compileStyles(request: StyleCompilerRequest): StyleCompilerResult | Promise<StyleCompilerResult>` performing utility CSS validation/deduplication without Tailwind.
- A compiler manifest `styleTokens` key containing either `string[]` (as emitted by the current compiler implementation branch) or `ExtractedStyleToken[]` (as described by the M0 styles contract). Strings receive the source file and offset 0 because the compiler does not expose token spans. Accurate token diagnostics require a coordinated compiler change.
- Executable `@zaakiyjs/dom/compiler` runtime ABI with compatible owner cleanup, exported by the independent DOM package.

No alternative implementation is substituted when a dependency is absent or reports invalid output. Style errors and dynamic CSS classes fail; other style warnings are surfaced without rejecting valid builds. The entire PR remains **draft** until the real packages are merged and jointly tested.

## Caching, errors, HMR, security

Vite handles graph and chunk building. This plugin caches transformed files by exact source content, configuration, browser targets, Vite dependency revision and transformed dependency-content hash; importing-module edits and brand updates invalidate relevant caches. It deliberately uses a **full document reload** for TSX/import-graph/brand edits because no component-instance-compatible hot-update/owner-disposal protocol has been frozen. It does not claim state-preserving HMR.

Compiler errors are fatal with original file/line/column; warnings are emitted to Vite. Invalid style metadata, stylesheet diagnostics, malformed source maps, and missing implementations are errors. Output is inspected for `@zaakiyjs/{ai,proxy,compiler,styles,vite-plugin}` imports, including bundle module identities. This is a defense-in-depth check, not a general data-flow or secret scanner. Never import secret-bearing config into browser application code.

## Verification

```sh
pnpm install --frozen-lockfile
pnpm --filter @zaakiyjs/vite-plugin lint
pnpm --filter @zaakiyjs/vite-plugin typecheck
pnpm --filter @zaakiyjs/vite-plugin build
pnpm --filter @zaakiyjs/vite-plugin test
```

The root CI Vitest suite and the package-local Vitest suite both run the actual Vite dev server and production build against `tests/fixtures/basic/`. While compiler/styles are types-only, successful TSX compilation and brand-only CSS tests are skipped and **real Vite refusal** tests verify the fail-closed boundary. After the implementations land, run full Vite+DOM browser integration for: TSX, source maps, invalid JSX, utility CSS deduplication, brand overrides and invalidation, multi-module import graphs, HMR ownership disposal, AI/server dependency absence, and identical production hashes across pinned builds. **These acceptance gates are pending, not passed.**

Release intent: independent minor bump via Changesets after the integration gate, not automatic publication.
