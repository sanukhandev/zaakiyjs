# Compiler, Versioned IR and Native DOM

## Pipeline

TypeScript/TSX source -> parser adapter -> type diagnostics -> semantic/binding analysis -> versioned IR -> deterministic optimization passes -> JS + CSS + source maps + feature manifests -> Vite. The compiler owns semantics, not an AI model.

## Versioned intermediate representation

Initial IR node families (proposed names):

| Family | Purpose |
| --- | --- |
| `StaticElement` / `StaticText` | Immutable DOM structure and hoisted markup |
| `DynamicText` | Targeted text binding using `Text.data` |
| `PropertyBinding` | Typed property/attribute/class/style writes |
| `EventBinding` | Stable listener ownership and cleanup |
| `ConditionalBlock` | Mount/remove conditional DOM regions |
| `KeyedLoop` | Stable keyed reconciliation and identity |
| `ComponentCall` | Component instantiation within owner scope |
| `StyleToken` | Utility extraction and theme/brand references |
| `CompatFeature` | Browser feature analysis and selective transforms |

Maintain an explicit `irVersion` and adapters/migrations when changing serialized contracts. Keep upstream TS AST details behind a parser adapter; don't couple optimization passes to TypeScript internal node layouts.

## Semantic guarantees

- Preserve order and count of observable expression evaluations and side effects; treat unknown calls as impure.
- Never hoist user-specific mutable data or signals into module-global shared state.
- Emit one-time static element creation, binding-specific updates and owner-scoped listeners/effects.
- Preserve focus, controlled input DOM identity, accessibility semantics, event handler ordering and SVG namespaces.
- Read signals dynamically inside tracked expressions when dependencies cannot be determined statically.
- Emit precise original source file/line/column diagnostics and accurate source maps.
- Disallow unsafe HTML injection by default; only an explicitly trusted sink with policy may render HTML.

## Mandatory optimization passes

Safe constant folding, static subtree hoisting, fine-grained binding generation, dead-code elimination (in concert with bundler), eligible handler stabilization, CSS token extraction/deduplication, browser target compatibility, bundle splitting hints and source-map output.

Optimization is accepted only with a correctness fixture. Generated output is an implementation detail; publicly documented source semantics remain the contract.

## Compatibility / Polyfill Zone

Modes: `off`, `auto`, `strict`. Analyze declared browser targets and known syntax/API use. Reuse vetted transpilers and scoped ponyfills where possible. Do not monkey-patch async globals by default or claim that every Web API can be polyfilled. Emit `compat-manifest.json` with target, transform/shim, inclusion reason and byte impact. In strict mode, reject unsupported/unapproved behavior.

## v0.1 behavioral fixtures

Counter: two targeted text bindings, zero unrelated DOM mutations. Todo: stable controls and cleanup. Keyed list: reordering preserves node identity and focus. Conditional blocks: no retained listeners/effects after exit. Dynamic dependencies: subscription graph changes safely across branches. Compile the same pinned source/deps/config twice and assert identical assets/hashes.

## Extension policy

Any new compiler pass is registered with declared IR version support, safety/side-effect assumptions, pass order, tests and diagnostics. Plugins cannot execute arbitrary code in untrusted contexts; document capabilities and trust level.
