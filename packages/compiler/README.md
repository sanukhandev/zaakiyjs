# @zaakiyjs/compiler

Node/build-time TSX compiler for ZaakiyJS. Uses **TypeScript 5.9.3**, not a custom parser/bundler. This release is a **safe, deliberately incomplete first vertical slice**, not a claim that all v0.1 TSX behavior already works.

## API

The M0 public interfaces remain unchanged: CompileRequest, CompileResult, GeneratedAsset, CompilerDiagnostic, IRDocument, IRNode, IRExpression, SourceSpan, IR_SCHEMA_VERSION (= 1).

- compile(request): CompileResult — parse, analyze, optimize, lower supported TSX, and produce deterministic JS with an inline-sources source-map asset.
- parseToIR(request) — inspect the serialized IR v1 plus parse diagnostics.
- validateIR(document) — reject incompatible IR versions, malformed nested nodes/source spans, duplicate IDs, unknown fields and cyclic references.
- optimizeIR(document) — pure, version-checked optimization with stable node identities.
- OPTIMIZATION_PASSES — documented implemented pass names.

The compiler result is ordered arrays of JS and CSS assets, diagnostics, optional manifest, and irVersion. A fatal diagnostic yields **no executable JS/CSS assets**. The manifest records DOM ABI version, pass names, sorted style tokens and requested target browsers; CSS compilation remains the responsibility of @zaakiyjs/styles.

## Supported emission

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

## Explicit unsupported behavior

- Root-level conditional/keyed regions, component-root templates that capture stale item snapshots (use live zero-arg getters), complex/deconstructed map parameters, and unsupported reactive keyed attributes/props fail closed. Nested keyed loops and multi-root fragment templates are supported within native host parents. Supported conditional/keyed forms use the reviewed additive DOM region ABI (ADR 0004).
- JSX spreads, top-level fragments, refs, component children, dynamic attributes/classes/styles, **all inline style attributes**, dynamic handler replacement, SVG foreignObject, unsafe HTML sinks and untrusted URL schemes produce focused diagnostics.
- Reactivity analysis recognizes `.value` reads from aliases and nested props, but cannot prove all indirect reactive dependencies (for example, an unknown function that internally reads a signal). Calls in detected reactive text expressions fail closed without purity proof; destructured snapshot reads do not become magically reactive.
- Dynamic text child expressions must have primitive TS types; arrays, object views and prebuilt JSX nodes require an explicit child/view semantics contract.
- No CSS generation, browser compatibility lowering, SSR, hydration, or tree-shaking of unrelated source declarations. The compiler does not claim to be a bundler. Supplying explicit `targetBrowsers` fails with ZC2301 until a tested browser compatibility profile is frozen.
- Generated JavaScript uses real public DOM/Core/Signals imports. Basic Counter, conditional branch, and keyed element behavior have cross-package integration fixtures; do not infer unsupported TSX syntax or full cross-browser parity from these cases.
- Source maps are generated using TypeScript with **statement-level TSX provenance**; the test suite decodes VLQ mappings to verify a generated reactive binding maps to its original TSX line. Browser/devtools column and breakpoint fidelity still require cross-package validation.

## Engineering constraints

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

## Measured CI baseline

The Counter fixture compiled on the GitHub Actions Node 22 runner with TypeScript 5.9.3, using a single cold-ish invocation inside the fixture test:

| Measure | Observed |
| --- | ---: |
| Generated JavaScript | 1,296 bytes (unminified) |
| Generated JavaScript gzip | 509 bytes |
| Counter compile wall time | 201.30 ms (single CI run; not a benchmark percentile) |
| Compiler behavior tests | 25/25 passed |
| Compiler package/ESM artifact tests | 2/2 passed |
| Full workspace tests | 42/42 passed |

This baseline is from [CI run 41793641788](https://github.com/sanukhandev/zaakiyjs/actions/runs/41793641788). The independent npm pack dry run passed. These figures are **fixture output**, not framework runtime bundle size. No claim of meeting the 12 KiB runtime target is made. Generated maps have line-level binding validation; browser/devtools source-map validation remains open.

**Integration status:** TypeScript 5.9.3 and the compiler lockfile importer are pinned. The current compiler branch passes frozen pnpm installation. Signals, Core and DOM are now merged. DOM region ABI v1 was frozen by ADR 0004 and the compiler validates real conditional/keyed fixtures in the DOM integration suite. Full browser matrix, CSS/Vite source semantics, extended TSX, accessibility/security and publication remain separately gated.

No npm publication is authorized without per-package approval, scope verification, runtime/browser tests and release checks.

## M1 extended control flow (ADR 0006)

Within native host parents, the compiler now flattens JSX fragments to native children without introducing a wrapper element, accepts multiple `<Show>` branch roots and fragment fallbacks, and supports nested `<For>` loops with lexical item signal stacks. The existing `IR_SCHEMA_VERSION=1` and DOM region ABI v1 remain intact; `whenTrue`, `whenFalse`, and `body` already encode arrays of child IR nodes. At runtime, the compiler emits a native `DocumentFragment` for multi-root insertion; owners and stable comment anchors are still managed by the existing DOM region API.

Keyed component-root templates are supported when each varying item prop is a simple zero-argument live getter, e.g. `live={() => item}`, and the component uses `computed(() => props.live().field)`. Direct item snapshots, arbitrary getter factories, implicit reactive props and root-level TSX fragments remain rejected. See ADR 0006. No virtual DOM is introduced. Three-browser acceptance is required for this extension.

## Compiler-generated static server output (PR #61)

`compileStaticServer({ fileName, source, routeId })` is an additive, build-time **literal-only** TSX-to-HTML server compiler. It emits an ES module exporting `protocol = "zaakiy.render/1"` and a `render(context)` function returning `no-store` HTML. The compiler does not import browser DOM or ship any TSX/IR interpreter to Node HTTP requests. Static HTML text and values are escaped, and unsafe HTML elements, attributes, URLs, styles, event handlers, dynamic text, reactive state, components and keyed loops are rejected rather than silently degraded.

The emitted `js[0].code` is the exact module source. Encode it to bytes at build time and pass those bytes to `@zaakiyjs/ssr/build`'s `buildVerifiedManifestV1` and `verifyTrustedArtifactBytes`, then activate the byte-attested Node adapter. The compiler does **not** produce hydration markers or claim to reuse server DOM; see [ADR 0010](../../docs/adr/0010-static-server-compiler-slice.md). Full compiler SSR/hydration remains issue #59.

## Request-scoped data SSR — experimental

`compileDataServer({ fileName, source, routeId })` generates a Node server renderer from supported **read-only typed props paths** without interpreting TSX during HTTP requests. Example source:

```tsx
function Product(props: { customer: { name: string }; order: number }) {
  return <main class="item"><h1>{props.customer.name}</h1><p>{props.order}</p></main>;
}
```

The renderer reads the corresponding paths from `ServerRequestContextV1.loaderData` via own-property descriptors, disallowing accessors and nonplain objects, and escapes primitive values before returning HTML. It uses the established `zaakiy.render/1` protocol with `no-store` caching. The deployment must pin the emitted module bytes through `buildVerifiedManifestV1`, `verifyTrustedArtifactBytes` and the byte-attested SSR Node adapter. Compiled source cannot access arbitrary context fields or invoke JS expressions. This **does not** hydrate browser DOM or support dynamic attributes/components/slots; issue #59 remains open. See [ADR 0012](../../docs/adr/0012-data-bound-ssr.md).

## Experimental component default slots (IR v2)

`compile({ fileName, source, componentSlots: true })` emits IR v2 with `ComponentCall.children` and `SlotOutlet`. Example:

```tsx
import type { JSXChild } from "@zaakiyjs/core/jsx-runtime";

function Panel(props: { readonly children?: JSXChild }) {
  return <section>{props.children}</section>;
}

function App() {
  return <Panel><button type="button">Open</button></Panel>;
}
```

This compiles a lazily mounted, caller-owned native slot factory. Each slot is single-use; the callee's outlet mounts it at a native parent and it disposes with the caller's lexical scope. Default `compile()` continues to emit IR v1 and reject component JSX children. Explicit `children` props conflicting with nested JSX, named slots, arbitrary JSX-in-props and runtime JSX interpretation remain rejected. See [ADR 0013](../../docs/adr/0013-component-slots-ir2.md).
