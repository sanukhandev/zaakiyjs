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

- Unsupported conditional branch shapes (multiple roots), nested keyed loops, complex/deconstructed map parameters, non-native keyed roots, and unsupported reactive keyed attributes/props fail closed. Supported conditional/keyed forms use the reviewed additive DOM region ABI (ADR 0004).
- JSX spreads, fragments, refs, component children, dynamic attributes/classes/styles, **all inline style attributes**, dynamic handler replacement, SVG foreignObject, unsafe HTML sinks and untrusted URL schemes produce focused diagnostics.
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
