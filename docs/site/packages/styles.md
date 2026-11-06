---
title: "@zaakiyjs/styles"
description: "Deterministic brand tokens, atomic utility CSS, recipes and responsive/dark variants"
sidebar_position: 5
---

# @zaakiyjs/styles

Generate a static CSS asset at build time. No Tailwind runtime, browser style compiler or AI dependency is required.

> **Availability:** Implemented source package in the repository, not a verified public npm release. All package manifests on the referenced commit are `0.0.0`; install from this workspace until independent publishing is approved.

## At a glance

- **Primary use:** Configure `zaakiy.config.ts`, use static utility tokens in TSX, and run stylesheet generation via the build integration.
- **Runtime boundary:** See the package README and public export map before importing into browser/server code.
- **Source revision:** [9f6c6603c98c](https://github.com/sanukhandev/zaakiyjs/commit/9f6c6603c98ca566c2fed6fed34cc770f6a72960).

## Try it from the monorepo

```sh
pnpm --filter @zaakiyjs/styles typecheck
pnpm --filter @zaakiyjs/styles test
pnpm --filter @zaakiyjs/styles build
```

## Feature usage: first working pattern

```ts
import { defineStyleConfig, defineRecipe } from '@zaakiyjs/styles';

export const styleConfig = defineStyleConfig({
  brand: { colors: { primary: '#2563eb' } },
  safelist: ['hidden']
});
const button = defineRecipe({
  base: 'inline-flex rounded-lg',
  variants: { size: { sm: 'px-2 py-1', lg: 'px-4 py-2' } },
  defaultVariants: { size: 'sm' }
});
console.log(button({ size: 'lg' }));
```

## Usage and correctness guidelines

- Class extraction is conservative: computed class names need explicit safelists or supported CSS-variable bindings.
- Generated CSS rules are deduplicated and deterministic; conflict resolution follows cascade order, not HTML class order.
- Custom brand palettes still require accessible contrast and visual review.

## Public API index

These are exported public symbols detected in `src/index.ts` at the source revision. Check types and package `exports` for supported subpaths and platform requirements.

- `BrandIdentity`
- `BrandMotion`
- `BrandOverride`
- `BrandTokens`
- `BrandTypography`
- `BrowserTargets`
- `CompoundVariant`
- `ExtractedStyleToken`
- `ExtractionResult`
- `RecipeDefinition`
- `RecipeSelection`
- `RecipeVariants`
- `StyleCompilerRequest`
- `StyleCompilerResult`
- `StyleConfig`
- `StyleDiagnostic`
- `StyleMetrics`
- `brandCss`
- `compileStyles`
- `cssVar`
- `defineBrand`
- `defineRecipe`
- `defineStyleConfig`
- `extractStyleTokens`
- `foundationStatus`
- `parseUtilityToken`
- `renderBrandScope`
- `resolveBrand`
- `resolveBreakpoints`
- `safeCssValue`
- `stableTokenId`
- `uniqueClasses`
- `validateBrand`

## Detailed feature guide

Sections below retain capability explanations and examples from the package's source README, not unimplemented proposals. Technical limitations inside a section remain applicable.

### Configuration (zaakiy.config.ts)

```ts
import { defineStyleConfig } from "@zaakiyjs/styles";

export default defineStyleConfig({
  brand: {
    identity: { name: "Acme", slug: "acme" },
    colors: { primary: "#1d4ed8", foreground: "#111827", background: "#fff" },
    spacing: { "4": "1rem", "6": "1.5rem" },
    fonts: { sans: '"Inter", ui-sans-serif, sans-serif' },
    radii: { lg: "0.75rem" },
    shadows: { card: "0 6px 24px rgb(0 0 0 / 0.12)" },
    breakpoints: { tablet: "800px" },
    typography: { fontSizes: { hero: "2.5rem" } },
    motion: { durations: { fast: "120ms" }, easings: { standard: "ease-out" } },
    appearance: { dark: { colors: { background: "#0f172a", foreground: "#fff" } } }
  },
  mode: "system", safelist: ["hidden", "block"]
});
```

`brand` is the developer-facing entrypoint. Default semantic colors, spacing, font, radius, shadow, breakpoint, typography and motion tokens are supplied unless overridden. Token names use ASCII alphanumeric and hyphen names; **no arbitrary CSS selector, `url(...)` value, `@import`, `/* ... */` comment, brace, or semicolon is allowed.** Invalid configurations produce error diagnostics and no stylesheet.

`mode: "system"` generates `prefers-color-scheme` dark-brand values, and `dark:` utility selectors activate automatically on a dark operating-system preference or under a `.dark` / `[data-zaakiy-mode="dark"]` ancestor. `mode: "light"` and `mode: "dark"` pin the default appearance; `dark:` utilities are unconditional in pinned dark mode. An explicit `[data-zaakiy-mode="light"]` scope resets only the tokens overridden by dark appearance. For app-level toggles, set `data-zaakiy-mode` on the app root. Dark variants are suppressed in explicitly light subtrees, even when the OS or an outer ancestor is dark. Re-enabling a dark variant *inside* an explicitly light subtree with a further nested dark marker is not supported by the v0.1 selector contract; keep appearance scopes non-overlapping until nearest-scope precedence is formalized. No JavaScript is shipped to toggle the mode. Set a brand scope on any route/feature boundary and apply generated overrides without rerendering children:

```ts
import { renderBrandScope } from "@zaakiyjs/styles";
const css = renderBrandScope("checkout", { colors: { primary: "#b91c1c" } });
// [data-zaakiy-brand="checkout"]{--z-color-primary:#b91c1c}
// <section data-zaakiy-brand="checkout"> ... </section>
```

### Compiling a stylesheet

```ts
import { compileStyles } from "@zaakiyjs/styles";

const result = compileStyles({
  config: { brand: { colors: { primary: "#2563eb" } }, safelist: ["hidden"] },
  tokens: [
    { token: "flex", file: "src/App.tsx", offset: 8 },
    { token: "gap-4", file: "src/App.tsx", offset: 13 },
    { token: "hover:bg-primary", file: "src/App.tsx", offset: 19 },
    { token: "md:p-6", file: "src/App.tsx", offset: 36 }
  ], minify: true
});
// result.css: standalone CSS asset, not injected into JS
// result.tokenIds: deterministic FNV-1a UTF-8 IDs, for indexing only
// result.diagnostics: file/offset-aware warnings and errors
// result.metrics: inputCount/uniqueCount and size estimates
```

Generated rules retain the source class names so TSX can render `class="flex gap-4"` without a runtime translator. They live in `@layer zaakiy.utilities`, after brand tokens in `@layer zaakiy.tokens`. This is the **v0.1 utility grammar and cascade choice**, requiring coordinated ADR review before it is treated as a frozen framework-wide language. Stable IDs are metadata, not the CSS class names. The future Vite plugin can consume `StyleCompilerRequest`/`StyleCompilerResult` directly, emit `virtual:zaakiy-styles.css`, and report diagnostics.

### Supported v0.1 utility classes

| Group | Examples |
| --- | --- |
| Display/position | `block`, `inline`, `inline-flex`, `flex`, `grid`, `hidden`, `relative`, `absolute`, `fixed`, `sticky` |
| Flexbox | `flex-row`, `flex-col`, `flex-wrap`, `items-center`, `justify-between`, `flex-1`, `grow` |
| Grid | `grid-cols-1`–`grid-cols-12`, `grid-rows-*`, `col-span-*`, `row-span-*` (1–12) |
| Spacing | `gap-4`, `gap-x-2`, `p-6`, `px-4`, `py-2`, `m-4`, `mx-auto`, `mt-2`, `inset-0` |
| Sizes | `w-full`, `w-1/2`, `h-screen`, `min-w-0`, `max-w-fit`, `w-4`, spacing-based sizes |
| Type | `text-center`, `text-xl`, `text-primary`, `font-bold`, `font-sans`, `leading-tight`, `tracking-wide` |
| Background, border | `bg-primary`, `border`, `border-2`, `border-primary`, `rounded-lg`, `rounded-full` |
| Visuals | `shadow-sm`, `opacity-50`, `truncate`, `overflow-hidden`, `select-none` |
| Motion | `transition`, `transition-colors`, `duration-fast`, `ease-standard`, `animate-fade-in` |
| States | `hover:bg-primary`, `focus:outline`, `focus-visible:outline`, `disabled:opacity-50` |
| Responsive | `sm:p-4`, `md:grid-cols-2`, `lg:hover:bg-primary`, also custom `brand.breakpoints` |
| Dark | `dark:bg-primary`, `dark:hover:text-foreground` |

Only the enumerated class families and safe configured token names are valid. **Not supported:** arbitrary CSS brackets, negative utilities, pseudo-elements, group/peer selectors, `!important` classes, container queries, every Tailwind class, or dynamic class expression evaluation. Unknown classes produce `ZSTY_UNKNOWN_UTILITY`. A dynamic expression should be explicitly safelisted or use a typed CSS-variable binding; `extractStyleTokens()` is a conservative helper and does not replace the TSX compiler's AST-based extraction. The helper warns `ZSTY_DYNAMIC_CLASS` with a file/offset.

Variants allow one responsive prefix, one `dark`, and one state prefix in any order; repeated and unknown prefixes are rejected. CSS is sorted by breakpoint **computed minimum-width** (using 16px for `em`/`rem` ordering), then state/dark priority and token spelling. Values with conflicting CSS properties at the same variant priority have a deterministic lexical cascade; do not rely on class attribute order to resolve conflicts. Class names are escaped for selectors (including `/`, `:`, and numeric-leading breakpoints). Utility naming and @layer precedence are deliberately local to this package until integration approval.

### Recipes

```ts
import { defineRecipe } from "@zaakiyjs/styles";

const button = defineRecipe({
  base: "inline-flex rounded-lg focus-visible:outline",
  variants: {
    size: { sm: "px-2 py-1", lg: "px-4 py-2" },
    intent: { primary: "bg-primary", subtle: "bg-surface" }
  },
  defaultVariants: { size: "sm", intent: "primary" }
});
button({ size: "lg" }); // stable deduplicated native class list
```

Recipes are component-independent, pure string compositions; their possible class combinations must appear in static extraction or safelists. The styles package has no browser runtime requirement.

### CSS transforms, accessibility and sizing

- PostCSS `8.5.32` parses and normalizes generated CSS and is used to flatten layer at-rules and insert compatibility-prefixed declarations. `minify: true` emits compact generated CSS without presentation-only line breaks; it is a **bounded compressor**, not a general CSS optimizer.
- `targets.safari < 15.4`, `targets.firefox < 97`, or `targets.chrome < 99` flatten the standalone Zaakiy Cascade Layers to ordinary rules (warning `ZSTY_COMPAT_LAYER_FLATTENED`). Safari targets older than 15.4 also generate `-webkit-user-select`; pre-Safari-13 `sticky` gets a `-webkit-sticky` fallback. Unsupported `:focus-visible` targets receive a `:focus` fallback and a behavior-change warning. These are **bounded compatibility transforms**, not universal browser feature support. Future comprehensive transforms/prefixing/minification should integrate a pinned Lightning CSS toolchain with explicit target validation.
- Motion utilities generate `@media (prefers-reduced-motion:reduce)` override rules. `focus-visible:` is supported directly without removing keyboard focus by default. `outline-none` exists but should not be used on actionable elements without a replacement focus indicator.
- `metrics.inputCount`, `metrics.uniqueCount`, `metrics.estimatedUndeduplicatedBytes`, `metrics.generatedBytes` report class-token count, deduplication and generated byte size. The pre-dedup metric is an estimate (accounts for repeated rule bodies but not an independently serialized full duplicate stylesheet).
- PostCSS validates output after values/selectors are restricted. There are no required browser-side styles JavaScript imports, dynamic `style` injection, network fetches or AI calls.
- A real TSX-origin CSS source map is not claimed: `sourceMap` remains absent until compiler/Vite integration can map generated rules back to original spans reliably.

### Validation and release

Run `pnpm --filter @zaakiyjs/styles lint`, `typecheck`, `build`, and `test`. The `typecheck` script validates both implementation and test sources. Tests cover parsing, invalid tokens/configuration, responsive/state/dark selectors, brand scopes, reduced motion, recipes, extraction, deterministic output, deduplication, basic browser prefixing and injection rejection.

The Styles package and its PostCSS dependency are part of the current workspace. Verify pinned builds and generated CSS behavior in the present repository rather than relying on historical M0 integration notes.

Independent SemVer and Changesets apply; npm scope ownership, package license and publication authorization are not established.

#### Cross-package diagnostic boundary

`StyleDiagnostic.severity === "warning"` does **not** invalidate CSS. The Vite integration must log warnings without stopping builds; only `severity === "error"` is fatal. Consumers must not unconditionally throw on a non-empty `result.diagnostics` array. The build integration must pass declared browser targets into `StyleConfig.targets` when requesting target-specific CSS transforms.

## Integrate with neighboring packages

- [@zaakiyjs/vite-plugin](./vite-plugin.md)
- [@zaakiyjs/ui](./ui.md)
- [@zaakiyjs/motion](./motion.md)
- [@zaakiyjs/templates](./templates.md)

## Source and maintenance

- [Package README](https://github.com/sanukhandev/zaakiyjs/blob/9f6c6603c98ca566c2fed6fed34cc770f6a72960/packages/styles/README.md)
- [Public exports](https://github.com/sanukhandev/zaakiyjs/blob/9f6c6603c98ca566c2fed6fed34cc770f6a72960/packages/styles/src/index.ts)
- [Package tests](https://github.com/sanukhandev/zaakiyjs/tree/9f6c6603c98ca566c2fed6fed34cc770f6a72960/packages/styles/test) (some packages use `tests/`)
- Update this guide in the same PR that changes public APIs, compiler/DOM behavior, security rules or feature support.
