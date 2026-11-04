# ADR 0006 — Nested keyed regions and multi-root fragment templates

- **Status:** Implemented for the supported M1 owner-scoped native DOM subset; browser acceptance required before merge.
- **Date:** 2026-11-04
- **Extends:** ADR 0004 (DOM region ABI v1), ADR 0005 (TSX control-flow).
- **IR:** No schema change: `ConditionalBlock.whenTrue/whenFalse` and `KeyedLoop.body` already contain arrays of IR nodes. `IR_SCHEMA_VERSION` remains 1.

## Syntax and lifecycle semantics

```tsx
const groups = signal([{ id: "g", name: "Group", children: [{ id: "c", label: "Child" }] }]);

function View() {
  return <main>
    <Show when={true} fallback={<><p>A</p><p>B</p></>}>
      <h1>Group</h1><p>Ready</p>
    </Show>
    <For each={groups.value} by={g => g.id}>
      {g => <>
        <h2>{g.name}</h2>
        <ul><For each={g.children} by={child => child.id}>
          {child => <li>{g.name}:{child.label}</li>}
        </For></ul>
      </>}
    </For>
  </main>;
}
```

A JSX fragment under a native parent is **compile-time grouping**; no untracked synthetic wrapper is added. A multi-root conditional branch and keyed template are emitted to a native `DocumentFragment`, then mounted within existing comment-delimited DOM ranges. The fragment itself does not remain as a DOM node. The existing owner owns all nodes between stable anchors, controls child setup/mount, and disposes child scopes before removal.

A nested keyed loop inherits outer named item contexts plus a new lexical item signal. The compiler rewrites item reads innermost-first and lower-level collection/key reads against the visible outer cells. Replacing a parent object at the same key triggers targeted reactive descendants and nested loop updates; replacing a child under its same key does not replace its DOM node. Key identity and duplicate key detection remain scoped separately to each keyed region. Unmount disposes nested scopes/listeners child-first.

Multi-root keyed views preserve a **contiguous start/end range**, so reorders atomically move all sibling roots without reinitializing owners. Focus/selection and existing input DOM identity are retained by the existing keyed range mover. A parent region can be empty but `<For>` requires a nonempty render template.

## Boundaries and security

- **Top-level root fragments** remain rejected: without a dedicated root-IR contract, silently turning an arbitrary TSX root into a DOM tree would be unsafe.
- **Component-root keyed item templates** remain rejected until a typed, signal-aware prop contract prevents item snapshots from becoming stale. Ordinary nested functional components keep their existing ABI.
- Dynamic classes/styles/attributes, implicit JSX spread, async keyed factories, arbitrary key selector calls and unsafe HTML sinks remain fail-closed.
- No virtual DOM, new runtime dependency, `innerHTML`, `eval`, new Function, or global async monkey patch.
- Node/build-time compiler may emit standard browser `document.createDocumentFragment()` for multi-root placement; no new DOM ABI helper is required.

## Acceptance

Require strict TypeScript, compiler IR golden fixtures, targeted DOM mutation and focus/cleanup tests, and browser-level conditional, nested item replacement, reorder, removal and detached listener checks in Chromium/Firefox/WebKit. Cross-engine green run, source-map validation and latest CI SHA must be recorded before treating these forms as accepted.
