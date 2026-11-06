---
title: "@zaakiyjs/compat"
description: "Build-time browser feature analysis, deterministic plans and opt-in scoped ponyfills"
sidebar_position: 14
---

# @zaakiyjs/compat

Use Compat to report supported/unsupported target features; it does not automatically make the compiler target every browser.

> **Availability:** Source implementation in ZaakiyJS, not a verified published npm release. The package's manifest at the referenced revision uses `0.0.0`; use workspace tooling until independent publishing is approved.

## At a glance

- **Use it when:** Run compatibility analysis in Node/CI, then integrate approved transformations explicitly at the build boundary.
- **Reference revision:** [9f6c6603c98c](https://github.com/sanukhandev/zaakiyjs/commit/9f6c6603c98ca566c2fed6fed34cc770f6a72960).

## Try it in the monorepo

```sh
pnpm --filter @zaakiyjs/compat typecheck
pnpm --filter @zaakiyjs/compat test
pnpm --filter @zaakiyjs/compat build
```

## Feature usage: first working pattern

```ts
import { analyzeCompatibility, serializeManifest } from '@zaakiyjs/compat';

const result = analyzeCompatibility({
  mode: 'strict',
  targets: { browsers: ['chrome >=124', 'firefox >=100', 'safari >=17.4'] },
  sources: [{ fileName: 'src/main.ts', source: 'new AbortController();' }]
});
if (!result.ok) throw new Error('Unsupported browser target usage');
const manifest = serializeManifest(result.manifest);
console.log(manifest);
```

Use `@zaakiyjs/compat/abort` explicitly for the scoped AbortSignal helpers rather than assuming globals are patched.

## Usage and correctness guidelines

- The standalone analysis engine is implemented, but compiler/Vite-wide transform orchestration and browser certification are not.
- `off`, `auto`, and `strict` differ in reporting policy; never treat an `auto` warning as evidence of compatibility.
- Manifest byte costs are estimates and registry support metadata is not a full browser test matrix.

## Public API index

Exported symbols detected in the package root `src/index.ts`. Platform-specific subpaths and structural contracts are explained in the detailed guide and package manifest.

- `BrowserFamily`
- `BrowserTarget`
- `COMPAT_DATA_VERSION`
- `CompatAnalysisRequest`
- `CompatIRDocument`
- `CompatIRNode`
- `CompatMode`
- `CompatibilityAnalysis`
- `CompatibilityDiagnostic`
- `CompatibilityManifest`
- `CompatibilityProfile`
- `CssFeatureEvidence`
- `FEATURE_REGISTRY`
- `FeatureCategory`
- `FeatureDefinition`
- `FeaturePlan`
- `FeatureReference`
- `FeatureRequirement`
- `JavaScriptTransformRequest`
- `SourceInput`
- `StrategyKind`
- `StrategySelection`
- `StylesTargetAdapter`
- `TargetConfiguration`
- `analyzeCompatibility`
- `compareVersions`
- `detectIRFeatures`
- `detectSourceFeatures`
- `detectStylesFeatures`
- `foundationStatus`
- `getFeature`
- `listFeatures`
- `parseMode`
- `resolveTargets`
- `serializeManifest`
- `targetLabel`
- `toStylesTargets`
- `transformEmittedJavaScript`
- `validateManifest`

## Detailed feature guide

### Public API

The root entrypoint is Node/build-time only:

- analyzeCompatibility(request): CompatibilityAnalysis
- parseMode, resolveTargets, listFeatures, getFeature
- serializeManifest, validateManifest
- detectSourceFeatures, detectIRFeatures, detectStylesFeatures
- transformEmittedJavaScript: explicit post-emission JavaScript-only TypeScript ES2019 transform
- toStylesTargets: adapter for the current public Styles target type

The browser-safe subpath is deliberately separate:

- @zaakiyjs/compat/abort: composeAbortSignals and scopedTimeoutSignal

Consumers must import the subpath explicitly. No browser bundle should import the root analysis entrypoint, TypeScript, or the feature database.

### Deterministic input

Mode defaults to off. In auto or strict, supply exactly one profile or explicit browser target list. Profiles are frozen aliases (not moving "latest"): modern-2024 = Chrome/Edge 124, Firefox 124, Safari 17.4; legacy-2020 = Chrome/Edge 80, Firefox 78, Safari 13.1.

Supported families: chrome, edge, firefox, safari. Targets accept exact versions (chrome 124), inclusive minimums (chrome >=124) or bounded ranges (safari 16.4..17.4). An unbounded >= target is evaluated at its declared **minimum**; a future browser is not implicitly certified. Bounds are pinned in targets.ts; unsupported/ambiguous declarations throw. The package does not make live compatibility lookups.

Example API call:

```ts
import { analyzeCompatibility, serializeManifest } from "@zaakiyjs/compat";

const result = analyzeCompatibility({
  mode: "strict",
  targets: { browsers: ["chrome >=124", "firefox >=100", "safari >=17.4"] },
  sources: [{ fileName: "src/app.ts", source: "const controller = new AbortController();" }]
});
if (!result.ok) throw new Error("Compatibility plan failed");
const json = serializeManifest(result.manifest);
// Integration owner writes json as compat-manifest.json in the output folder.
```

Mode semantics: off detects but plans nothing and emits an informational no-guarantee diagnostic; auto selects approved strategies and warns on unresolved features; strict marks unresolved/dynamic/unsupported requirements as errors. Neither mode silently rewrites source in this package. No compatible feature usage => no selected helper.

### Detection scope

Uses TypeScript 5.9.3 parser for selected JS/TS syntax, selected global Web API references, and explicit imports from @zaakiyjs/compat/abort. Parses IR v1 CompatFeature nodes and nested nodes through the public JSON-like contract. CSS feature evidence must come from an adapter at the Styles boundary: css.selector-has, css.container-query, css.nesting and css.color-mix. The package does not introspect private Styles modules or parse arbitrary CSS text.

Static analysis is *not* a guarantee. Computed property names, shadowed names, code loaded at runtime, third-party dependencies, dynamic imports, browser plugins and CSS not surfaced by the styles adapter need an additional build graph scan. Source locations are stored, source content and credentials are not.

Registry entries document category, detection, pinned minimum browser support, strategy, security and estimated byte cost. All current registry browser support evidence is labeled metadata-only. It is not a claim of real-browser test coverage.

### Approved strategies

- Native support, when pinned minimum versions meet all requested browser target floors.
- TypeScript ES2019 syntax downlevel plan for supported optional-chain, nullish and logical-assignment expressions. transformEmittedJavaScript can apply the approved plan only to emitted .js/.mjs/.cjs; the active compiler does not call it.
- Scoped AbortSignal.any composition via explicit import of composeAbortSignals from @zaakiyjs/compat/abort.
- Scoped wall-clock timeout via explicit import of scopedTimeoutSignal. This is **not identical** to native AbortSignal.timeout's active-time pause semantics and must be consciously adopted.
- Unsupported diagnostics for APIs without an approved strategy (e.g. unavailable ResizeObserver / structuredClone), unsafe dynamic code, and CSS lacking an approved transform.

Direct AbortSignal.any() or AbortSignal.timeout() calls on unsupported targets are **not automatically rewritten**. A helper is included in the plan only when imported from the approved subpath and called explicitly. AbortController and abort reason support must still be native where the helper requires them. Both helpers return {signal, dispose}; caller/owner must call dispose on teardown. No global monkey patch.

No global polyfills are currently approved. No new runtime shim package is downloaded. Zero AI code or network access is required by the build-time plan.

### Manifest v1

CompatibilityAnalysis.manifest and serializeManifest produce a deterministic schemaVersion=1 document with dataVersion, mode, declared/resolved targets, features and source references, selected transforms/shims, inclusion reasons, estimated bytes, unsupported features, diagnostics, documented limitations and a deterministic FNV-1a identifier. The hash is for reproducibility comparison **not security**. Estimates are preliminary, not measured gzip or actual final bundle sizes.

A representative manifest fragment (not a recorded build artifact):

```json
{
  "schemaVersion": 1,
  "dataVersion": "zaakiy-compat-2026-11-04.1",
  "mode": "auto",
  "resolvedTargets": [{ "browser": "firefox", "minimum": "100" }],
  "transforms": [],
  "shims": [{ "id": "abort-any", "kind": "scoped-ponyfill",
    "module": "@zaakiyjs/compat/abort",
    "reason": ["web.abort-signal-any"], "estimatedBytes": 570 }]
}
```

The actual emitted manifest also includes declaredTargets, detectedFeatures, unsupportedFeatures, diagnostics, limitations, estimatedExtraBytes and hash.

### Compiler/Vite/Styles contract still required

1. Compiler currently diagnoses targetBrowsers as ZC2301. A separate coordinated PR must define when compatibility consumes IR, how emitted JS transform safety and source maps are validated, and how a fatal strict diagnostic suppresses executable assets.
2. Vite Plugin must orchestrate analysis across the application AND dependency graph, produce the manifest artifact and prevent accidental browser bundling of the root entrypoint. This package **does not** claim targetBrowsers compilation works.
3. Styles public BrowserTargets currently accepts Chrome/Firefox/Safari numeric floors, but not Edge or bounded ranges. toStylesTargets returns omittedFamilies instead of falsely treating Edge as Chrome. Strict analysis fails when CSS evidence requires an Edge target that Styles cannot encode. A coordinated integration PR should extend this contract and wire CSS feature evidence and any vetted PostCSS transforms.
4. The repository M0 verify-workspaces script currently rejects new packages. The lockfile has no packages/compat importer. Updating these shared files is **intentionally outside** this isolated P1-04 scope; frozen workspace CI remains blocked until coordinated integration.
5. The test/fixtures/browser-abort.html smoke fixture must be served with a built dist directory and executed in real Chromium, Firefox and WebKit as part of an approved browser matrix. **The fixture is not evidence that these browser runs have passed.** No target-specific shim is approved as browser-verified until such runs are collected.

### Data provenance and limitations

The frozen support thresholds were curated from MDN Browser Compatibility Data and related MDN docs on 2026-11-04, including:

- https://github.com/mdn/browser-compat-data
- https://developer.mozilla.org/en-US/docs/Web/API/AbortController
- https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal/any_static
- https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal/timeout_static
- https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal/reason
- https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_nesting
- https://developer.mozilla.org/en-US/docs/Web/CSS/:has

Metadata lacks complete implementation quirks, mobile/webview coverage and accessibility/security behavior. The registry is an intentionally conservative selected subset, not the entire web platform. Each matrix update requires review, new pinned version, regression fixtures and actual browser testing.

## Integrate with neighboring packages

- [@zaakiyjs/compiler](./compiler.md)
- [@zaakiyjs/vite-plugin](./vite-plugin.md)
- [@zaakiyjs/styles](./styles.md)
- [@zaakiyjs/async](./async.md)

## Source and maintenance

- [Package README](https://github.com/sanukhandev/zaakiyjs/blob/9f6c6603c98ca566c2fed6fed34cc770f6a72960/packages/compat/README.md)
- [Public source exports](https://github.com/sanukhandev/zaakiyjs/blob/9f6c6603c98ca566c2fed6fed34cc770f6a72960/packages/compat/src/index.ts)
- [Package test cases](https://github.com/sanukhandev/zaakiyjs/tree/9f6c6603c98ca566c2fed6fed34cc770f6a72960/packages/compat/test)
- Update this page when public APIs, runtime semantics or platform guarantees change.
