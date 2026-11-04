# ADR 0006 — Nested keyed regions and multi-root fragment templates

- **Status:** Proposed acceptance for native DOM nested keyed lists and fragment templates; final CI and review required before merge.
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
- **Keyed component-root item templates** require an explicit live getter prop (`live={() => item}`) rather than passing `item` directly. The component initializes once for a key, then may track `computed(() => props.live().field)`; the getter captures the owner-scoped item signal and remains valid after same-key replacement. Only simple zero-argument getter expressions are authorized; direct snapshots and arbitrary accessor factories fail with `ZC2206`. This is an *explicit opt-in protocol*, not magic reactive props.
- **Top-level root fragments** and implicit dynamic component props remain unsupported. Ordinary nested functional components continue using the existing owner ABI.
- Dynamic classes/styles/attributes, implicit JSX spread, async keyed factories, arbitrary key selector calls and unsafe HTML sinks remain fail-closed.
- No virtual DOM, new runtime dependency, `innerHTML`, `eval`, new Function, or global async monkey patch.
- Node/build-time compiler may emit standard browser `document.createDocumentFragment()` for multi-root placement; no new DOM ABI helper is required.

## Acceptance

Require strict TypeScript, compiler IR golden fixtures, targeted DOM mutation and focus/cleanup tests, and browser-level conditional, nested item replacement, reorder, removal and detached listener checks in Chromium/Firefox/WebKit. Cross-engine green run, source-map validation and latest CI SHA must be recorded before treating these forms as accepted.

## Explicit signal-aware component template

```tsx
function GroupRow(props: { live: () => { id: string; name: string } }) {
  const name = computed(() => props.live().name);
  return <li>{name.value}</li>;
}
<For each={groups.value} by={g => g.id}>
  {g => <GroupRow live={() => g} />}
</For>
```

This pattern preserves the existing strongly typed `ComponentCall` props and v1 IR. The compiler rewrites the zero-arg getter to the keyed item's stable signal cell and rejects direct values that could become stale. Components must explicitly derive or access reactive state within owner-managed bindings; the compiler does **not** transform arbitrary component functions into rerendering views.
