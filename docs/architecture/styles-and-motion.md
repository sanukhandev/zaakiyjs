# Brand-First CSS, UI Recipes and Motion

## Brand configuration

The developer config surface is `zaakiy.config.ts`, with a typed `brand` declaration covering identity, color, typography, spacing, shape, adaptive layout, appearance modes and motion. Theme-like variants are internally represented as scoped CSS custom properties, but **branding is the developer-facing concept**.

`@zaakiyjs/styles` owns utility parsing, token generation, style recipes, responsive/state variants, CSS extraction and optimization. Use mature CSS tooling such as Lightning CSS for parsing/transforms/target minification rather than inventing a complete CSS parser.

## Utility and recipe strategy

Familiar classes (for example `flex gap-4 rounded-lg bg-primary`) are interpreted by Zaakiy's own compiler. Tailwind is inspiration, not a required dependency or strict compatibility promise. Build atomic rules and dead-code elimination deterministically. Prefer modern native CSS: custom properties, nesting, cascade layers, container queries, `@scope` where targets allow it, OKLCH, `color-mix()`, `clamp()`, Grid/subgrid and media/feature queries.

Dynamic classes require static enumerations/safelists or CSS variable bindings. Do not silently omit runtime-computed utility names. Apply brand overrides at app, route or feature scopes without JS rerenders.

## UI architecture

`ui-primitives` owns unstyled accessible behavior (focus, portals, dialogs, listboxes). `ui` owns brand-aware visual components. `templates` owns editable TSX page templates. Visual decisions must not be entangled with event and accessibility logic. Minimum primitives: layout, button, fields, dialog, tabs, dropdown, tooltip and toast; grow only after lifecycle/portal/focus contracts pass.

## Motion architecture

CSS-first transitions and keyframes belong in `styles`. `@zaakiyjs/motion` is optional for presence, keyed reorders, layout, shared-element transitions, scroll interactions, gestures and springs. Use browser WAAPI/View Transitions where supported; ship JS controllers only when needed.

Enter -> active -> exit -> dispose is a motion policy, not an alternative ownership tree. Interrupted/aborted animation must release handles and preserve focus. Respect `prefers-reduced-motion` by default and avoid layout thrashing; favor transforms and opacity.

## AI design proposal boundary

Gemini may propose brand palettes, CSS recipes, layouts or motion presets under explicit consent. Validate grammar/allowed selectors, brand constraints, contrast/focus/accessibility, CSS compatibility and CSS size; present a diff for human approval. Accepted outputs become local versioned files so ordinary builds never call AI.

## Acceptance tests

Snapshot generated CSS deterministically; verify no unused known static utilities, brand overrides without DOM subtree rerender, responsive and dark variants, no forbidden runtime CSS generation, and reduced-motion behavior in real browsers.
