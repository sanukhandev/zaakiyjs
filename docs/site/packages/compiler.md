---
title: "@zaakiyjs/compiler"
description: "TypeScript/TSX analysis, versioned IR, safe optimization and native-DOM code generation"
sidebar_position: 4
---

# @zaakiyjs/compiler

Compiler runs in Node/Vite, never in the browser. It produces JS and diagnostics for the supported TSX subset.

> **Availability:** Implemented source package in the repository, not a verified public npm release. All package manifests on the referenced commit are `0.0.0`; install from this workspace until independent publishing is approved.

## At a glance

- **Primary use:** Author supported typed TSX, pass it through the Vite plugin, and inspect compiler diagnostics rather than falling back to a React JSX runtime.
- **Runtime boundary:** See the package README and public export map before importing into browser/server code.
- **Source revision:** [9f6c6603c98c](https://github.com/sanukhandev/zaakiyjs/commit/9f6c6603c98ca566c2fed6fed34cc770f6a72960).

## Try it from the monorepo

```sh
pnpm --filter @zaakiyjs/compiler typecheck
pnpm --filter @zaakiyjs/compiler test
pnpm --filter @zaakiyjs/compiler build
```

## Feature usage: first working pattern

```tsx
import { signal } from '@zaakiyjs/signals';

export function Counter() {
  const count = signal(0);
  return <button onClick={() => { count.value++; }}>
    {count.value}
  </button>;
}
```

The compiler lowers this supported pattern to owner-scoped native nodes and a text binding; the snippet is **source TSX**, not a browser-executable JSX runtime.

## Usage and correctness guidelines

- The IR schema is versioned; introducing incompatible nodes requires a coordinated ADR and ABI tests.
- Unknown calls in reactive expressions are conservatively rejected when purity cannot be proven.
- JSX spreads, arbitrary component children, component refs, reactive ref replacement, dynamic classes/styles and general hydration remain unsupported. Native element callback refs use an opt-in connected-mount helper on the hardening branch.

## Public API index

These are exported public symbols detected in `src/index.ts` at the source revision. Check types and package `exports` for supported subpaths and platform requirements.

- `CompatFeature`
- `CompileRequest`
- `CompileResult`
- `CompilerDiagnostic`
- `ComponentCall`
- `ConditionalBlock`
- `DiagnosticSeverity`
- `DynamicText`
- `EventBinding`
- `GeneratedAsset`
- `IRDocument`
- `IRExpression`
- `IRNode`
- `IRNodeBase`
- `IRVersion`
- `IR_SCHEMA_VERSION`
- `KeyedLoop`
- `PropertyBinding`
- `Purity`
- `SourceSpan`
- `StaticElement`
- `StaticText`
- `StyleToken`
- `compile`
- `foundationStatus`
- `parseToIR`
- `optimizeIR`
- `validateIR`
- `OPTIMIZATION_PASSES`

## Detailed feature guide

Sections below retain capability explanations and examples from the package's source README, not unimplemented proposals. Technical limitations inside a section remain applicable.

### API

The M0 public interfaces remain unchanged: CompileRequest, CompileResult, GeneratedAsset, CompilerDiagnostic, IRDocument, IRNode, IRExpression, SourceSpan, IR_SCHEMA_VERSION (= 1).

- compile(request): CompileResult — parse, analyze, optimize, lower supported TSX, and produce deterministic JS with an inline-sources source-map asset.
- parseToIR(request) — inspect the serialized IR v1 plus parse diagnostics.
- validateIR(document) — reject incompatible IR versions, malformed nested nodes/source spans, duplicate IDs, unknown fields and cyclic references.
- optimizeIR(document) — pure, version-checked optimization with stable node identities.
- OPTIMIZATION_PASSES — documented implemented pass names.

The compiler result is ordered arrays of JS and CSS assets, diagnostics, optional manifest, and irVersion. A fatal diagnostic yields **no executable JS/CSS assets**. The manifest records DOM ABI version, pass names, sorted style tokens and requested target browsers; CSS compilation remains the responsibility of @zaakiyjs/styles.

### Supported emission

- Native HTML/SVG static elements, static text, static attributes and safe DOM properties, in source evaluation order.
- Signal-backed text and property updates using the frozen bindText/bindProperty ABI.
- Owned stable native event listeners using listen(owner,...).
- Synchronous nested functional components initialized under child owners.
- Compile-time literal conditional elimination and dynamic true/false conditional regions through the reviewed owner-scoped DOM ABI.
- A constrained native-element `items.map(item => <Element key={item.id}>...)` keyed-loop lowering path with stable owner/node identity and signal-backed item replacement; no JSX interpreter.
- Typed compiler-only `<Show when={...} fallback={<p>...}>...` and `<For each={...} by={item => item.id}>{item => <li>...</li>}</For>` intrinsics imported from `@zaakiyjs/core`, lowered to the existing region ABI. Native single-root templates only; see ADR 0005.
- Static class utility token discovery (metadata only, not CSS generation).
- Impure **nonreactive** expressions evaluated once at setup; reactive expressions containing unknown calls fail closed.
- Hygienic generated identifiers, stable ESM import ordering, and no browser DOM/helper imports for TSX modules without JSX.
- Conservative reactivity detection for aliased and nested `.value` reads; actual dependencies are dynamically tracked by the runtime.

Example:

    declare function signal<T>(initial: T): { value: T };
    function Counter() {
      const count = signal(0);
      return <button onClick={() => count.value++}>{count.value}</button>;
    }

Generated output imports helpers from @zaakiyjs/dom/compiler and owners from @zaakiyjs/core. DOM text is created via createText, updated via bindText, and never inserted via innerHTML. This is an **ABI consumer**, not a working browser preview while the M1 core/signals/DOM packages are being developed.

### Explicit unsupported behavior

- Root-level conditional/keyed regions, component-root templates that capture stale item snapshots (use live zero-arg getters), complex/deconstructed map parameters, and unsupported reactive keyed attributes/props fail closed. Nested keyed loops and multi-root fragment templates are supported within native host parents. Supported conditional/keyed forms use the reviewed additive DOM region ABI (ADR 0004).
- JSX spreads, top-level fragments, component refs, string refs, reactive ref replacement, component children, unbounded dynamic class expressions, **all inline style attributes**, dynamic URL attributes, dynamic handler replacement, SVG foreignObject and unsafe HTML sinks fail closed. Bounded class variants and reactive non-URL attributes are supported on the hardening branch. Native element callback refs compile to opt-in `bindMountedRef` and do not modify the frozen eager `bindRef` semantics.
- Reactivity analysis recognizes `.value` reads from aliases and nested props, but cannot prove all indirect reactive dependencies (for example, an unknown function that internally reads a signal). Calls in detected reactive text expressions fail closed without purity proof; destructured snapshot reads do not become magically reactive.
- Dynamic text child expressions must have primitive TS types; arrays, object views and prebuilt JSX nodes require an explicit child/view semantics contract.
- No CSS generation, browser compatibility lowering, SSR, hydration, or tree-shaking of unrelated source declarations. The compiler does not claim to be a bundler. Supplying explicit `targetBrowsers` fails with ZC2301 until a tested browser compatibility profile is frozen.
- Generated JavaScript uses real public DOM/Core/Signals imports. Basic Counter, conditional branch, and keyed element behavior have cross-package integration fixtures; do not infer unsupported TSX syntax or full cross-browser parity from these cases.
- Source maps are generated using TypeScript with **statement-level TSX provenance**; the test suite decodes VLQ mappings to verify a generated reactive binding maps to its original TSX line. Browser/devtools column and breakpoint fidelity still require cross-package validation.

### Engineering constraints

- No React/Vue/Angular, Zone.js, Gemini SDK or browser-side compiler import.
- No eval, new Function, innerHTML, or model-generated source execution in emitted production output.
- Stable IDs are based on original TSX spans. Version 1 is explicit; breaking IR changes require coordination.
- Local compilation is deterministic for pinned source, TypeScript version and options.
- URL-valued dynamic attributes, unsafe URI schemes and lowercase inline `on*` event strings are rejected until a reviewed URL/security policy is available.

Run from the repository root (after installing workspace dependencies):

    pnpm --filter @zaakiyjs/compiler typecheck
    pnpm --filter @zaakiyjs/compiler lint
    pnpm --filter @zaakiyjs/compiler test
    pnpm --filter @zaakiyjs/compiler build

### M1 extended control flow (ADR 0006)

Within native host parents, the compiler now flattens JSX fragments to native children without introducing a wrapper element, accepts multiple `<Show>` branch roots and fragment fallbacks, and supports nested `<For>` loops with lexical item signal stacks. The existing `IR_SCHEMA_VERSION=1` and DOM region ABI v1 remain intact; `whenTrue`, `whenFalse`, and `body` already encode arrays of child IR nodes. At runtime, the compiler emits a native `DocumentFragment` for multi-root insertion; owners and stable comment anchors are still managed by the existing DOM region API.

Keyed component-root templates are supported when each varying item prop is a simple zero-argument live getter, e.g. `live={() => item}`, and the component uses `computed(() => props.live().field)`. Direct item snapshots, arbitrary getter factories, implicit reactive props and root-level TSX fragments remain rejected. See ADR 0006. No virtual DOM is introduced. Three-browser acceptance is required for this extension.

## Integrate with neighboring packages

- [@zaakiyjs/dom](./dom.md)
- [@zaakiyjs/core](./core.md)
- [@zaakiyjs/styles](./styles.md)
- [@zaakiyjs/vite-plugin](./vite-plugin.md)

## Source and maintenance

- [Package README](https://github.com/sanukhandev/zaakiyjs/blob/9f6c6603c98ca566c2fed6fed34cc770f6a72960/packages/compiler/README.md)
- [Public exports](https://github.com/sanukhandev/zaakiyjs/blob/9f6c6603c98ca566c2fed6fed34cc770f6a72960/packages/compiler/src/index.ts)
- [Package tests](https://github.com/sanukhandev/zaakiyjs/tree/9f6c6603c98ca566c2fed6fed34cc770f6a72960/packages/compiler/test) (some packages use `tests/`)
- Update this guide in the same PR that changes public APIs, compiler/DOM behavior, security rules or feature support.

### Connected native JSX refs (integration branch)

A native element accepts a stable typed callback such as `<button ref={node => { /* node is HTMLButtonElement | null */ }} />`. The generated helper waits until the node is connected, delivers the node once per mount, and sends `null` on owner disposal; keyed reorders do not create another attachment. A detached `DocumentFragment` mount is observed until connection or disposal. A string ref, component ref, or reactive replacement of the ref callback is rejected. Previous TSX without refs keeps the original DOM helper import surface. This extension is not a substitute for the still-open component slot, variant or hydration contracts.

### Finite reactive class variants and safe attributes

The compiler supports `class={active.value ? "pill active" : "pill inactive"}` by statically enumerating every branch class token and emitting an exact byte offset for the first source occurrence. The Vite styles bridge verifies each offset against the actual TSX text before compiling CSS. Non-enumerable expressions such as `class={computedName.value}` fail with `ZC2212`; escaped class literals lacking a trustworthy raw-source token position fail with `ZC2213`. Static class literals retain the original manifest contract. Reactive `aria-*`, `data-*`, `title` and other non-URL attributes use the existing owner-scoped `bindAttribute` helper; reactive class variants use `bindClass`. Neither path injects CSS rules or parses HTML. Dynamic URL attributes and all raw inline styles remain rejected until separately validated contracts are approved.
