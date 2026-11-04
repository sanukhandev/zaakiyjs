# @zaakiyjs/compiler

Node/build-time TSX compiler for ZaakiyJS. Uses **TypeScript 5.9.3**, not a custom parser/bundler. This release is a **safe, deliberately incomplete first vertical slice**, not a claim that all v0.1 TSX behavior already works.

## API

The M0 public interfaces remain unchanged: CompileRequest, CompileResult, GeneratedAsset, CompilerDiagnostic, IRDocument, IRNode, IRExpression, SourceSpan, IR_SCHEMA_VERSION (= 1).

- compile(request): CompileResult — parse, analyze, optimize, lower supported TSX, and produce deterministic JS with an inline-sources source-map asset.
- parseToIR(request) — inspect the serialized IR v1 plus parse diagnostics.
- validateIR(document) — reject incompatible IR versions and malformed document/node headers.
- optimizeIR(document) — pure, version-checked optimization with stable node identities.
- OPTIMIZATION_PASSES — documented implemented pass names.

The compiler result is ordered arrays of JS and CSS assets, diagnostics, optional manifest, and irVersion. A fatal diagnostic yields **no executable JS/CSS assets**. The manifest records DOM ABI version, pass names, sorted style tokens and requested target browsers; CSS compilation remains the responsibility of @zaakiyjs/styles.

## Supported emission

- Native HTML/SVG static elements, static text, static attributes and safe DOM properties, in source evaluation order.
- Signal-backed text and property updates using the frozen bindText/bindProperty ABI.
- Owned stable native event listeners using listen(owner,...).
- Synchronous nested functional components initialized under child owners.
- Compile-time literal conditional elimination (true/false only).
- Static class utility token discovery (metadata only, not CSS generation).
- Impure **nonreactive** expressions evaluated once at setup; reactive expressions containing unknown calls fail closed.

Example:

    declare function signal<T>(initial: T): { value: T };
    function Counter() {
      const count = signal(0);
      return <button onClick={() => count.value++}>{count.value}</button>;
    }

Generated output imports helpers from @zaakiyjs/dom/compiler and owners from @zaakiyjs/core. DOM text is created via createText, updated via bindText, and never inserted via innerHTML. This is an **ABI consumer**, not a working browser preview while the M1 core/signals/DOM packages are being developed.

## Explicit unsupported behavior

- Dynamic conditional DOM ranges and keyed lists: DOM ABI v1 has **no frozen range, keyed-list or ownership-lifecycle operations**. These produce ZC2201/ZC2202 rather than invented runtime imports.
- JSX spreads, fragments, refs, component children, dynamic attributes/classes/styles, dynamic handler replacement, SVG foreignObject, unsafe HTML sinks and untrusted URL schemes produce focused diagnostics.
- Reactivity detection currently tracks local variables directly initialized by signal() or computed(). Arbitrary signal aliases, destructured reactive references and reactive props require an explicit future analysis contract. Call expressions in reactive views are rejected without purity proof.
- No CSS generation, browser compatibility lowering, SSR, hydration, or tree-shaking of unrelated source declarations. The compiler does not claim to be a bundler.
- JavaScript output uses the M0 reserved helper names but **cannot be declared end-to-end executable until DOM runtime and mount/component return-value contracts are implemented and jointly verified**.
- Source maps are generated using TypeScript source mapping and original-node remapping; detailed generated-binding column accuracy requires cross-package validation.

## Engineering constraints

- No React/Vue/Angular, Zone.js, Gemini SDK or browser-side compiler import.
- No eval, new Function, innerHTML, or model-generated source execution in emitted production output.
- Stable IDs are based on original TSX spans. Version 1 is explicit; breaking IR changes require coordination.
- Local compilation is deterministic for pinned source, TypeScript version and options.

Run from the repository root (after installing workspace dependencies):

    pnpm --filter @zaakiyjs/compiler typecheck
    pnpm --filter @zaakiyjs/compiler lint
    pnpm --filter @zaakiyjs/compiler test
    pnpm --filter @zaakiyjs/compiler build

**Integration blocker:** The compiler's newly declared TypeScript runtime dependency requires coordinated regeneration of pnpm-lock.yaml. The parallel package branches must not rewrite the shared lockfile independently. Until the integration owner resolves that dependency and the runtime packages implement their declared v1 helpers, leave the pull request in draft.

No npm publication is authorized without per-package approval, scope verification, runtime/browser tests and release checks.
