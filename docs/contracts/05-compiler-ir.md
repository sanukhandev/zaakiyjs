# Contract 05 — IR v1, diagnostics and compiler results

**Owner:** `@zaakiyjs/compiler`. Serialized schema version `irVersion: 1` and `IR_SCHEMA_VERSION = 1`. IR is JSON-compatible data; TypeScript Node/SyntaxKind objects, symbol tables and parser internals must stay behind private adapters.

A document is `{ irVersion: 1, sourceFile: string, nodes: IRNode[] }`. Every node has stable `id` and `span: {file,start:{line,column,offset},end:{line,column,offset}}`; line/column are **1-based**, offset **0-based** in original source. Keep source expressions as `IRExpression {source,span,purity,reactive}`, never embedded executable functions. Unknown calls are `purity: "unknown"` and cannot be hoisted.

Discriminants in v1: `StaticElement`, `StaticText`, `DynamicText`, `PropertyBinding`, `EventBinding`, `ConditionalBlock`, `KeyedLoop`, `ComponentCall`, `StyleToken`, `CompatFeature`. Names and field types are in the compiler package's exported TypeScript interfaces. Parser adapters may carry private richer metadata during analysis, but serialization and public optimizer passes must use stable IR. Node IDs must survive safe optimization when identity survives; if identity changes, record mapping for diagnostics.

A compile request contains `fileName`, `source`, optional `rootDir` and browser targets. A result contains `irVersion`, ordered `js[]` and `css[]` generated assets (`fileName`, `code`, optional source `map`), `diagnostics[]` (code, severity, message, optional span), and optional `manifest`. Diagnostics distinguish errors/warnings/info. No successful JS/CSS asset may be presented as executable when fatal diagnostics exist. Maps must point to original TSX locations.

**Safety:** preserve observable evaluation order/count and source semantics; static hoisting and constant folding require purity proof. Stable outputs must be content-deterministic for pinned inputs. Compatibility transforms/manifests can be added without importing compat shims into browser code inadvertently.

M0 validates data-shape compatibility only; it does not parse or transform TSX. A concrete IR JSON schema, AST grammar edge cases, and compiler emitted ABI version negotiation require implementation-phase ADR review.

## Versioned experimental default JSX slots

Contract v1 is frozen. An explicitly requested `componentSlots: true` compiler mode may emit IR document version 2, adding optional `ComponentCall.children` and a `SlotOutlet` for the literal `{props.children}` expression in native elements. `validateIR` must reject v2-only fields in version 1, unknown versions, malformed children and duplicate IDs; the optimizer and CSS source-tracing must traverse v2 children without changing version 1 outputs. A DOM slot factory is caller-owned, single-use and lazily mounted by a native outlet. See [ADR 0013](../adr/0013-component-slots-ir2.md). No general named-slot or hydration guarantee is implied.
