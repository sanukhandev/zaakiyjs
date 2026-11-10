---
title: "@zaakiyjs/vite-plugin"
description: "Vite integration for TSX compilation, CSS assets, diagnostics, cache invalidation and rebuilds"
sidebar_position: 6
---

# @zaakiyjs/vite-plugin

Use the plugin in Vite config to transform supported TSX into native-DOM JavaScript and emit deterministic styles.

> **Availability:** Implemented source package in the repository, not a verified public npm release. All package manifests on the referenced commit are `0.0.0`; install from this workspace until independent publishing is approved.

## At a glance

- **Primary use:** Configure Vite at build time. Import the generated virtual stylesheet as prescribed by your app/build integration.
- **Runtime boundary:** See the package README and public export map before importing into browser/server code.
- **Source revision:** [9f6c6603c98c](https://github.com/sanukhandev/zaakiyjs/commit/9f6c6603c98ca566c2fed6fed34cc770f6a72960).

## Try it from the monorepo

```sh
pnpm --filter @zaakiyjs/vite-plugin typecheck
pnpm --filter @zaakiyjs/vite-plugin test
pnpm --filter @zaakiyjs/vite-plugin build
```

## Feature usage: first working pattern

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import { zaakiyPlugin } from '@zaakiyjs/vite-plugin';

export default defineConfig({
  plugins: [zaakiyPlugin({ configFile: 'zaakiy.config.ts' })],
  build: { sourcemap: true }
});
```

## Usage and correctness guidelines

- TSX HMR currently uses full reload where component-instance-preserving HMR is not implemented.
- Build outputs include styles and asset metadata; browser applications must not import compiler/CLI/AI/server-only modules.
- **Do not set nonempty `browserTargets` for a TSX application yet.** The Compiler rejects explicit target browsers with fatal `ZC2301` until Compat integration is complete; the runnable configuration deliberately omits this option.

## Public API index

These are exported public symbols detected in `src/index.ts` at the source revision. Check types and package `exports` for supported subpaths and platform requirements.

- `GeneratedAssetRecord`
- `VirtualCssContract`
- `VitePluginFactory`
- `ZaakiyAssetManifest`
- `ZaakiyViteOptions`
- `foundationStatus`
- `zaakiyPlugin`

## Detailed feature guide

Sections below retain capability explanations and examples from the package's source README, not unimplemented proposals. Technical limitations inside a section remain applicable.

### Usage

```ts
// vite.config.ts — once compiler, styles and DOM implementations have landed
import { defineConfig } from "vite";
import { zaakiyPlugin } from "@zaakiyjs/vite-plugin";

export default defineConfig({
  plugins: [
    zaakiyPlugin({
      configFile: "zaakiy.config.ts"
    })
  ],
  build: { sourcemap: true }
});
```

A static TSX component imports `virtual:zaakiy-styles.css` automatically from the generated JS. In development the virtual module serves the current aggregate stylesheet. In HTML production builds a deterministic `assets/zaakiy-styles.css` (or configured `cssFileName`) is emitted, linked into HTML, and enumerated in `zaakiy-assets.json` (schema version 1). The manifest never embeds absolute build-host source paths: source file IDs are project-relative and omitted for virtual/external modules. Non-HTML/library consumers must add the emitted CSS file to their distribution manually. A configured brand or safelist can generate CSS even when no TSX files are transformed, once the styles engine is available.

The public `zaakiyPlugin()` factory is exported from the package root and a compatibility `./plugin` subpath remains available. Runtime/browser compatibility must be verified for each supported TSX pattern; an executable adapter does not mean unrestricted TSX syntax or state-preserving hot updates.

### Public configuration

- `configFile`: optional path to a trusted `StyleConfig` default export. The default is an empty `brand` rather than executing arbitrary project config during a build. Configuration is loaded by Vite in Node, never embedded into client JS. On change, development fully reloads.
- `include` / `exclude`: standard Vite/Rollup filter patterns; only `.tsx` and `.mtsx` files are eligible by default. Ordinary JS/TS is delegated to Vite.
- `browserTargets`: currently **not usable with TSX**. A nonempty value is forwarded to the Compiler, which emits fatal `ZC2301` and fails dev/build. Leave it unset until a separately tested Compat/Compiler/Vite integration lands; the option's presence is not evidence of compatibility support.
- `cssFileName`: optional safe CSS asset path under `assets/`, default `assets/zaakiy-styles.css`. Directory traversal and URL-like values are rejected.
- `cssVirtualId`: frozen to `virtual:zaakiy-styles.css`; other values fail rather than creating incompatible public imports.

No mandatory Tailwind, React Fast Refresh, or browser-side compiler is included. Unsupported SSR transform (explicitly rejected, never delegated to another JSX compiler), arbitrary custom CSS output names and per-entry CSS splitting are not yet supported.

### Integration contract and blocking prerequisites

The adapter connects the executable Compiler, Styles and DOM packages. Its output, diagnostics and CSS token integration use these public contracts:

- `@zaakiyjs/compiler.compile(request: CompileRequest): CompileResult | Promise<CompileResult>` returning one JS asset per transformed TSX module, IR version 1, a valid source map when requested, and diagnostics with original TSX spans.
- `@zaakiyjs/styles.compileStyles(request: StyleCompilerRequest): StyleCompilerResult | Promise<StyleCompilerResult>` performing utility CSS validation/deduplication without Tailwind.
- A compiler manifest `styleTokens` key containing either `string[]` (as emitted by the compiler) or `ExtractedStyleToken[]` (as described by the M0 styles contract). String tokens are resolved against the original source using the real `@zaakiyjs/styles.extractStyleTokens` public extractor. Only offsets verified against the exact source are accepted; an unresolvable token fails with an actionable `ZV2011`/`ZV2013` diagnostic instead of fabricating offset 0. The preferred long-term compiler contract remains directly emitted `ExtractedStyleToken[]` spans.
- Executable `@zaakiyjs/dom/compiler` runtime ABI with compatible owner cleanup, exported by the independent DOM package.

No alternative implementation is substituted when a dependency is absent or reports invalid output. Style errors and dynamic CSS classes fail; other style warnings are surfaced without rejecting valid builds.

### Caching, errors, HMR, security

Vite handles graph and chunk building. This plugin caches transformed files by exact source content, configuration, browser targets, Vite dependency revision and transformed dependency-content hash; importing-module edits and brand updates invalidate relevant caches. It deliberately uses a **full document reload** for TSX/import-graph/brand edits because no component-instance-compatible hot-update/owner-disposal protocol has been frozen. It does not claim state-preserving HMR.

Compiler errors are fatal with original file/line/column; warnings are emitted to Vite. CSS source-map comments reference the generated map relative to the chosen CSS filename, including custom nested `assets/` paths. Invalid style metadata, stylesheet diagnostics, malformed source maps, and missing implementations are errors. Output is inspected for `@zaakiyjs/{ai,proxy,compiler,styles,vite-plugin}` imports, including bundle module identities. This is a defense-in-depth check, not a general data-flow or secret scanner. Never import secret-bearing config into browser application code.

## Integrate with neighboring packages

- [@zaakiyjs/compiler](./compiler.md)
- [@zaakiyjs/styles](./styles.md)
- [@zaakiyjs/dom](./dom.md)
- [@zaakiyjs/cli](./cli.md)

## Source and maintenance

- [Package README](https://github.com/sanukhandev/zaakiyjs/blob/9f6c6603c98ca566c2fed6fed34cc770f6a72960/packages/vite-plugin/README.md)
- [Public exports](https://github.com/sanukhandev/zaakiyjs/blob/9f6c6603c98ca566c2fed6fed34cc770f6a72960/packages/vite-plugin/src/index.ts)
- [Package tests](https://github.com/sanukhandev/zaakiyjs/tree/9f6c6603c98ca566c2fed6fed34cc770f6a72960/packages/vite-plugin/test) (some packages use `tests/`)
- Update this guide in the same PR that changes public APIs, compiler/DOM behavior, security rules or feature support.
