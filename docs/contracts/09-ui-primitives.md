# Contract 09 — P2 headless UI primitives (proposed v1)

> **Status: contract-only.** The signatures below are reserved design contracts, not current exports or evidence of production behavior. Owner: future \`@zaakiyjs/ui-primitives\`. See [ADR 0007](../adr/0007-p2-ui-contract-boundaries.md) and [integration issue #37](https://github.com/sanukhandev/zaakiyjs/issues/37).

## Scope and dependencies

Provide **behavior without visual decisions**: managed focus/roving focus, dismissable layers, modal/nonmodal overlays, portal placement and accessible state. Dependencies flow to public \`@zaakiyjs/core\` owner APIs, \`@zaakiyjs/signals\`, and optionally the browser-safe \`@zaakiyjs/dom\` public API. Never import compiler, styles compiler, Router, Node modules, private package source or a virtual DOM renderer.

An element controller **attaches to a real HTMLElement supplied by its caller**, never a synthesized JSX node. Registration requires an explicit live \`OwnerScope\`; do not infer owner from an asynchronous continuation. Construction and teardown are idempotent, bounded and deterministic. Use native listeners and AbortSignal where appropriate; no global event/Promise/timer patches.

## Reserved public TypeScript shapes

These are contracts for implementers, **not code that consumers may import today**.

~~~ts
import type { OwnerScope } from "@zaakiyjs/core";
import type { ReadonlySignal } from "@zaakiyjs/signals";

export interface DisposableHandle { dispose(): void }
export type InteractionReason =
  | "pointer" | "keyboard" | "programmatic" | "focus" | "dismiss";
export interface InteractionDetail {
  readonly reason: InteractionReason;
  readonly originalEvent?: Event;
}
export type ValueChange<T> = (next: T, detail: InteractionDetail) => void;
export type Controllable<T> =
  | { readonly value: ReadonlySignal<T>; readonly defaultValue?: never;
      readonly onValueChange: ValueChange<T> }
  | { readonly value?: never; readonly defaultValue?: T;
      readonly onValueChange?: ValueChange<T> };

export interface ElementController<E extends HTMLElement = HTMLElement>
  extends DisposableHandle {
  readonly owner: OwnerScope;
  readonly element: E;
}
export interface FocusScopeOptions {
  readonly owner: OwnerScope;
  readonly container: HTMLElement;
  readonly initialFocus?: HTMLElement | (() => HTMLElement | null);
  readonly restoreFocus?: boolean;
  readonly trapFocus?: boolean;
}
export interface RovingFocusOptions {
  readonly owner: OwnerScope;
  readonly container: HTMLElement;
  readonly items: () => readonly HTMLElement[];
  readonly orientation?: "horizontal" | "vertical" | "both";
  readonly direction?: "ltr" | "rtl";
  readonly loop?: boolean;
}
export interface DismissableLayerOptions {
  readonly owner: OwnerScope;
  readonly element: HTMLElement;
  readonly trigger?: HTMLElement;
  readonly modal?: boolean;
  readonly onDismiss: (detail: InteractionDetail) => void;
}
export interface OverlayOptions extends DismissableLayerOptions {
  readonly open: Controllable<boolean>;
  readonly onEscapeKeyDown?: (event: KeyboardEvent) => void;
  readonly onPointerDownOutside?: (event: PointerEvent) => void;
}
export interface PortalOptions {
  readonly owner: OwnerScope;
  readonly host: Element | DocumentFragment;
  readonly nodes: readonly Node[];
}
export interface PortalHandle extends DisposableHandle {
  readonly owner: OwnerScope;
  readonly host: Element | DocumentFragment;
  readonly nodes: readonly Node[];
}
~~~

Reserved factories: \`createFocusScope(options): ElementController\`, \`createRovingFocus(options): ElementController\`, \`createDismissableLayer(options): ElementController\`, \`createOverlayController(options): ElementController\`, and \`createPortal(options): PortalHandle\`. Names are not implemented exports; implementations may split adapters while preserving these observable contracts.

### Controlled and uncontrolled invariants

A controlled value is **a readonly signal**, not a copied snapshot; controllers request changes only by calling the required \`onValueChange(next, detail)\`. The parent decides whether to update the source. The controller must not mutate it or optimistically claim a new state. An uncontrolled controller owns its internal signal and initializes it from \`defaultValue\` exactly once. A missing \`value\` is not a controlled false/undefined; no switching modes after initialization without explicit remount. Change callbacks are event notifications, not a second reactivity scheduler. Stable no-op changes must not emit duplicate callbacks. Event cancellation uses native \`preventDefault\` on cancelable original events where documented, never invented synthetic DOM events.

### Focus, layers and accessibility

- Focus scopes capture the previously focused element only for the active document and restore focus if it remains connected and focusable. Do not steal focus on unrelated reactive updates. Use tab order, disabled/inert/hidden checks and composed event paths for Shadow DOM boundaries.
- Roving focus implements one tabbable item at a time, Home/End and arrow-key behavior appropriate to orientation/RTL, and skips disabled items. Prevent default only for owned navigation keys. Preserve focus/selection across keyed DOM moves.
- Dialog/layer controllers preserve native roles, \`aria-modal\`, \`aria-expanded\`, \`aria-controls\`, \`aria-activedescendant\` and labeling contracts as applicable. Prefer native \`<dialog>\` where supported and appropriate; never invent a generic ARIA role for a component.
- Escape, focus-out and outside-pointer dismissal follow an explicitly documented layer stack. Only the top eligible layer dismisses; pointer-down inside a trigger/portal subtree is not outside. Modal inertness/scroll lock must be reference-counted and fully restored, never left on \`document.body\`.
- Capture relevant events on the active owner/document and release listeners, observers and locks on dispose. No global listeners at import time; no cross-application shared mutable stack.

### Portal ownership and DOM constraints

A portal **changes physical DOM placement, not logical owner ancestry**. Use the same document and a caller-provided host. The original owner controls subscriptions, focus, layer listeners and teardown even when the host lives outside its subtree; the host must never adopt a foreign application's owner. Dispose children and listeners before removing portal-owned nodes. Do not restore nodes to a source position that has been disposed. Validate duplicates, parent/ancestor cycles, foreign documents and ownership before insertion; failed insertion must leave preexisting DOM unchanged.

An arbitrary compiler-emitted static TSX node cannot be extracted from a keyed/conditional region without corrupting its range ownership. In v1, a portal takes **explicit native nodes** supplied by a caller that owns them. Declarative TSX slots and portal outlets await issue #37. \`transferOwner\` is not a portal operation.

### Attaching controllers before compiler refs exist

A caller may supply an existing host \`HTMLElement\` directly or use an **application-container-scoped** lookup **after** \`mount()\` returns, then attach with \`mountHandle.owner\`. A scoped query must check exactly the intended element, never query global \`document\` by assumed-unique ID. This is an integration escape hatch, **not** proof that UI TSX \`ref\` works. \`ref\` is currently typed by Core but rejected by Compiler; connected-element ref callbacks require the separately owned compiler/DOM work in issue #37.

## Test requirements before implementation is declared supported

Keyboard/RTL/disabled item behavior, nested layers, Escape/outside/Shadow DOM paths, focus restoration, inertness/scroll-lock restoration, portal disposal and reparent edge cases, cross-root isolation, listener/observer leaks and error cleanup; real Chromium/Firefox/WebKit tests and screen-reader-informed accessibility review. Verify no top-level DOM access during browser or Node/SSR package import. No published API or changeset is created by this document.
