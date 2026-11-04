# Contract 03 — TypeScript/TSX authoring (v1)

**Owner:** `@zaakiyjs/core` owns JSX namespace and component types; `@zaakiyjs/compiler` owns transforms. Source compiles with TypeScript strict checking and `jsxImportSource: "@zaakiyjs/core"`. M0 uses `jsx: preserve` exclusively for type checking: **there is no `jsx`, `jsxs` or `jsxDEV` runtime**.

```tsx
// Proposed future executable source, NOT usable at M0
import { signal, computed } from "@zaakiyjs/core";
import { mount } from "@zaakiyjs/dom";
function Counter() {
  const count = signal(0);
  const double = computed(() => count.value * 2);
  return <main><span>{count.value}</span><span>{double.value}</span>
    <button onClick={() => count.value++}>Increment</button></main>;
}
mount(() => <Counter />, document.getElementById("app")!);
```

Compilation recognizes dynamic expressions within text nodes, property/attribute/class/style bindings and typed event attributes. A reactive expression is *not* a license to rerun the component or drop focus/input identity. Evaluate event handlers only on dispatch; attach stable listeners once and remove by owner. JSX `class` maps to native `class`; `onClick` has a typed `MouseEvent`. Strings are escaped as text; unsafe HTML sinks require explicit trusted policy and are not part of M0.

M0's minimal JSX typing covers `div`, `main`, `h1`, `p`, `span`, `button`, `input`, `svg`, and `path` only. M1 must introduce exhaustive HTML/SVG intrinsic typing, refs, attributes, boolean properties and namespace behavior before executable TSX is claimed. `<Show>`/`<For>`, component children semantics, and event delegation are unresolved design decisions; avoid divergent agent-local implementations.

## Compiler-owned keyed identity

`key?: string | number | symbol` is a **compile-time** attribute allowed on typed native TSX elements. It is used only by keyed-loop lowering; the compiler must consume it and must reject unsupported placements with a source-positioned diagnostic. It must never be forwarded as a native HTML/SVG attribute. See [ADR 0004](../adr/0004-dom-region-abi.md) for runtime keyed identity and update semantics.
