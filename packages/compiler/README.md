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
- Compile-time literal conditional dead-branch elimination (true/false only) with stable node IDs.
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

- Dynamic conditional DOM ranges and keyed lists: DOM ABI v1 has **no frozen range, keyed-list or ownership-lifecycle operations**. These produce ZC2201/ZC2202 rather than invented runtime imports.
- JSX spreads, fragments, refs, component children, dynamic attributes/classes/styles, **all inline style attributes**, dynamic handler replacement, SVG foreignObject, unsafe HTML sinks and untrusted URL schemes produce focused diagnostics.
- Reactivity analysis recognizes `.value` reads from aliases and nested props, but cannot prove all indirect reactive dependencies (for example, an unknown function that internally reads a signal). Calls in detected reactive text expressions fail closed without purity proof; destructured snapshot reads do not become magically reactive.
- Dynamic text child expressions must have primitive TS types; arrays, object views and prebuilt JSX nodes require an explicit child/view semantics contract.
- No CSS generation, browser compatibility lowering, SSR, hydration, or tree-shaking of unrelated source declarations. The compiler does not claim to be a bundler. Supplying explicit `targetBrowsers` fails with ZC2301 until a tested browser compatibility profile is frozen.
- JavaScript output uses the M0 reserved helper names but **cannot be declared end-to-end executable until DOM runtime and mount/component return-value contracts are implemented and jointly verified**.
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
| Counter compile wall time | 189.08 ms (single run; not a benchmark percentile) |
| Compiler behavior tests | 25/25 passed |
| Full workspace tests | 40/40 passed |

These figures are **fixture output**, not framework runtime bundle size. No claim of meeting the 12 KiB runtime target is made. Generated maps have line-level binding validation; browser/devtools source-map validation remains open.

**Integration status:** The compiler TypeScript 5.9.3 dependency is declared and the compiler-only `pnpm-lock.yaml` importer is synchronized. The current compiler branch passes frozen pnpm installation. The independent core/signals/DOM feature branches are still awaiting coordinated integration, and DOM region/loop ABI v1 is not frozen. Do not merge or publish until the real runtime, browser, focus, ownership cleanup and keyed-list suites pass.

No npm publication is authorized without per-package approval, scope verification, runtime/browser tests and release checks.
