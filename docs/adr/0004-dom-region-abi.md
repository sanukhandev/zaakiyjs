# ADR 0004 — Native DOM region ABI v1 for conditional and keyed blocks

- **Status:** Accepted for the M1 compiler-to-DOM public ABI; compiler-generated behavior tests required before release.
- **Date:** 2026-11-04
- **Owners:** `@zaakiyjs/dom/compiler` runtime protocol; `@zaakiyjs/compiler` source/IR lowering.
- **Resolves:** RFC #14, conditional/keyed region ABI signatures. No new mandatory runtime dependency.

## Public ABI (additive to CompilerDomAbiV1)

```ts
interface DomRegion { readonly parent: Node; readonly start: Comment; readonly end: Comment }
createRegion(parent: Node, before?: Node | null): DomRegion
bindConditionalRegion(owner: OwnerScope, region: DomRegion,
  when: () => boolean,
  createTrue: (child: OwnerScope) => Node,
  createFalse?: (child: OwnerScope) => Node): BindingHandle
interface KeyedView<Item> {
  readonly node: Node;
  readonly update?: (item: Item) => void;
}
bindKeyedRegion<Key extends PropertyKey, Item>(owner: OwnerScope, region: DomRegion,
  read: () => readonly Item[], keyOf: (item: Item) => Key,
  create: (item: Item, child: OwnerScope) => KeyedView<Item>): BindingHandle
```

Export runtime functions and types via `@zaakiyjs/dom/compiler`; implementation may live in private modules. These are browser-runtime helpers and must not import `@zaakiyjs/compiler`, TS ASTs, Vite, AI or a virtual DOM.

## Region ownership

`createRegion` creates two **stable comment anchors**, inserts them into `parent` in front of `before`, and returns their identity. Parents own anchors; each binding owns only the child nodes between anchors, child owner scopes and associated effects/listeners. Range removals must dispose child owner resources **before** removing their nodes. No `innerHTML` parsing. Anchors survive conditional toggles and keyed reorder; final parent teardown can remove them with its DOM subtree.

For conditions: evaluate `when` in an owned `render` effect, untrack the branch factory, create a fresh child owner on activation, and mount only after DOM insertion. If `createFalse` is omitted, a false condition renders nothing. If supplied, both branches are exclusive and replacing a branch first disposes the outgoing owner and region nodes. Do not run component initialization again for an unchanged branch.

For keyed lists: `keyOf(item)` must yield a unique stable primitive `string | number | symbol` and must not register reactive dependencies in the list scheduler. Reject duplicates **before mutating child DOM**. Same-key entries retain their owner, anchors, node identity, input/focus and selection even across range moves. When an equal key has a **different item object/value**, `view.update` must be present; otherwise fail loudly before updating the tree, rather than retaining stale UI. Updaters run untracked and must modify existing bound state/DOM, never reinvoke the component. New additions stage before removal; failures roll back staged entries. Region `dispose` is idempotent.

Every region binding returns `BindingHandle.dispose()`; registration attaches cleanup to the parent owner. Child mount hooks run after the containing DOM is connected. Active parent/route ownership and SSR request provider isolation apply transitively.

## TSX and IR lowering

Ordinary TSX conditional children can lower to `ConditionalBlock` only when the compiler can prove their expression and branch semantics. `<Show>` and `<For>` are compiler intrinsics **only after typed source grammar is frozen**; no import-time JSX interpreter is permitted. For keyed `array.map(item => <Element key={item.id}>…</Element>)`, the compiler must preserve the item parameter, key expression and update semantics in versioned IR, then emit the ABI above. Unsupported component children, dynamic keys or unsafe expressions fail with diagnostics; no silent partial lowering.

A full `KeyedLoop` source lowering cannot be marked supported until same-key replacement is reflected by a stable targeted binding. The ABI is available independently of that compiler coverage. Do not bump IR schema without a formal coordinated migration.

## Deferrals and gates

SSR/hydration marker reuse, multi-root keyed templates, async per-item factories and animated exit transitions require later ADRs. Before merging compiler and DOM: compile a real TSX Counter, dynamic branch, and keyed loop against latest Signals/Core/DOM; assert MutationObserver only touches intended nodes, equal-key focus/selection identity, duplicate-key rejection, all cleanup once, and package ESM import/pack validity. Chromium plus Firefox and WebKit are release gates where supported.

## Migration

No previously published compiled code exists; ABI v1 adds optional region functions without changing frozen primitive signatures. Future generated output must advertise `domAbiVersion` and reject incompatible runtime versions instead of importing unavailable helpers.
