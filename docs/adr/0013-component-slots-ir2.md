# ADR 0013 — Opt-in IR v2 default component-children slots

- **Status:** Experimental integration on PR #61; evidence pending latest-head CI and review
- **Scope:** Core typed JSX, Compiler IR v2, DOM slot ownership, Vite compiler integration
- **Backward compatibility:** Frozen IR v1 and DOM region ABI v1 remain defaults; no implicit migration

## Problem

The native JSX compiler rejects `<Panel><button>Open</button></Panel>` with `ZC2102`, and `<section>{props.children}</section>` with the dynamic-text type guard. Passing child JSX as an eager object or rendering it as a string would violate single initialization, ownership and security constraints. The prior `createOwnedNativeSlot` primitive provides a safe, branded, anchored and single-use native-node factory, but the compiler cannot emit or consume it.

## Decision

Add **explicit** `componentSlots: true` to `CompileRequest` and `ZaakiyViteOptions`. This opts into IR document version **2**, adding only:

- An optional `children: readonly IRNode[]` field to `ComponentCall`, representing direct JSX child nodes under the caller's logical ownership.
- A `SlotOutlet` node representing the exact recognized native child expression `{props.children}`.

No v1 IR node shape, compiler result, generated JS helper selection or existing control-flow semantics change when the flag is omitted. `validateIR` rejects `children` or `SlotOutlet` nodes in a v1 document and rejects any other unsupported version. IR optimizer, style-token extraction, source offsets and compiler diagnostics traverse the v2 child subtree.

The v2 generator emits a lazy `createOwnedNativeSlot(callerOwner, childFactory)` and passes the resulting single-use handle as the component's `children` prop. The callee's native element `{props.children}` outlet emits `mountOwnedSlot(props.children, hostElement)`. The DOM runtime accepts only handles created by `createOwnedNativeSlot` (WeakSet provenance), mounts once, and preserves caller-side owner ancestry even when the callee inserts the slot into a portal host. Owner disposal tears down the scoped factory and exact anchored DOM range.

## Supported TSX subset

```tsx
import type { JSXChild } from "@zaakiyjs/core/jsx-runtime";

function Panel(props: { readonly children?: JSXChild }) {
  return <section class="panel">{props.children}</section>;
}

function App() {
  return <main><Panel><button type="button">Open</button></Panel></main>;
}
```

The `JSXChild` is an authoring-time type; the opt-in compiler lowers it to a native slot handle, not a runtime JSX object tree. The compiler does not invoke child constructors during prop evaluation or invoke the slot more than once.

### Explicit exclusions

- Named slots (`header`, `footer`) and JSX elements nested in arbitrary named props.
- JSX spread attributes and dynamic JSX node expressions other than the exact default `props.children` outlet.
- Multiple mounts of the same slot, implicit slot duplication, untrusted handles, or runtime JSX interpreters.
- Automatic backwards migration of existing IR v1 serialized documents.
- Full SSR/hydration and keyed/fragment exit animations.

Unknown expressions still produce existing diagnostics. An explicit `children` prop alongside JSX children is rejected with `ZC2501`. A root-level outlet without a native host fails `ZC2502`.

## Acceptance

- Golden v1 compilation must remain deterministic and preserve IR version 1.
- v2 validation must reject v1 slot-field leakage and unknown IR versions.
- Typed compiler tests assert real slot-factory helper generation, deterministic source output, and conflicting child props rejection.
- DOM unit tests assert brand provenance, one-shot mount, exact range cleanup, parent ownership and portal ancestry.
- The maintained M1 browser fixture opts in only for that test app, and runs `<SlotPanel><button>...</button><span>...</span></SlotPanel>` across Chromium, Firefox and WebKit. It verifies node identity, focus preservation on unrelated keyed reorder, event behavior and disposal. The expected matrix is 17 cases per browser.

## Follow-on work

A separately versioned named-slot and arbitrary-child-expression contract is still required. It must address nested slot binding names, typed prop ownership and compiler diagnostics without weakening the default v1 or the existing security policy. M4 dynamic SSR and real hydration remain independent. Issue #37 is partially addressed, not closed. Production publishing remains subject to issue #24.
