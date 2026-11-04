# Contract 06 — brand tokens and deterministic CSS

**Owner:** `@zaakiyjs/styles`; consumer `@zaakiyjs/compiler` identifies class tokens, `@zaakiyjs/vite-plugin` exports the asset.

Developer config is `zaakiy.config.ts` with `StyleConfig.brand` (colors, spacing, fonts, radii and breakpoints) plus appearance mode and safelist. It is a build-time source of truth, not a runtime Tailwind dependency.

The compiler sends `ExtractedStyleToken { token, file, offset }` values to the styles compiler. `StyleCompilerRequest {tokens,config,minify?}` produces `StyleCompilerResult {css,sourceMap?,diagnostics,tokenIds}`. Extraction must be pure, deterministic and deduplicated; output sorted by stable semantic ordering, not traversal concurrency. Preserve native CSS escape rules, syntax and browser targets; separate CSS and source maps from generated JS.

Dynamic class names must be explicitly statically enumerated, safelisted, or expressed through typed CSS variable bindings; never silently omit styles. Unknown/invalid token diagnostics point to source file/offset. CSS variables support app/route/feature brand overrides without full component rerenders. Include focus/reduced-motion semantics and no mandatory Tailwind runtime. No CSS-in-JS network dependency.

M0 offers only the config and result types, not parsing, CSS output, utility grammar or recipes. Token grammar, hash stability, CSS layer precedence and variant order remain open in [decisions](08-open-decisions.md).
