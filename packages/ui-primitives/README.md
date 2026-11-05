# @zaakiyjs/ui-primitives

Unstyled, native DOM behavior controllers for owner-scoped ZaakiyJS applications. **Draft P2 implementation. Not published or browser-certified.** The approved P2 API contract was not yet committed to `main` when this implementation branch began. Public API names below must be reconciled with the frozen contract prior to release.

## Runtime dependencies

Only `@zaakiyjs/core` for synchronous ownership and `@zaakiyjs/signals` for reactive state. No runtime JSX engine, CSS, virtual DOM, compiler, network API, global Promise patch or global component registry.

Controllers attach to **existing native DOM elements**. Application or compiler code is responsible for creating DOM nodes and stable IDs; do not invoke controllers on templates until compiler lowering supports the required ref/children syntax. Instantiate them within `runWithOwner` or pass an explicit live `OwnerScope`. Dispose on removal; root disposal also invokes cleanup.

```ts
import { createOwner, disposeOwner } from "@zaakiyjs/core";
import { createOverlayManager, createDialog } from "@zaakiyjs/ui-primitives";

const owner = createOwner();
const root = document.querySelector<HTMLElement>("#app")!;
const host = document.querySelector<HTMLElement>("#app-overlays")!;
const dialog = document.querySelector<HTMLElement>("#account-dialog")!;
const overlays = createOverlayManager({ root, host, owner });
const controller = createDialog({
  element: dialog, owner, overlays, labelledBy: "dialog-title",
  modal: true, defaultOpen: false
});
controller.setOpen(true);
// Later: disposeOwner(owner) closes all associated layers and listeners.
```

## API overview

| Behavior | Factory | Keyboard/focus model |
| --- | --- | --- |
| Ownership, timers, IDs | `own`, `listen`, `ownedTimeout`, `createIdScope` | Event/timer lifecycle and stable scope-local IDs |
| State | `createControlledState` | External signal remains source of truth; default only used when uncontrolled |
| Focus | `createFocusManager`, `createFocusScope` | Initial focus, Tab containment if requested, previous-focus restoration |
| Portal/layers | `createPortal`, `createOverlayManager` | Detached nodes, explicit host, topmost Escape/outside pointer |
| Composite keyboard | `createRovingFocus` | Arrow/Home/End, RTL, orientation, disabled skipping, dynamic registration |
| Dialog | `createDialog` | Role, name, aria-modal, focus scope, inertness, dismissal |
| Tabs | `createTabs` | Tablist relationships, arrows, manual/automatic activation |
| Disclosure/accordion | `createDisclosure`, `createAccordion` | Native button triggers, aria-expanded, hidden panel, optional exclusive expansion |
| Menu | `createMenu` | Menuitem/trigger, arrows, Enter/Space, Escape and outside pointer |
| Listbox | `createListbox` | Single-select, aria-activedescendant, arrows, Home/End, typeahead |
| Tooltip | `createTooltip` | Noninteractive description, focus/hover delay, Escape |
| Popover | `createPopover` | Nonmodal dismissable layer; optional initial focus |

## Boundary and accessibility notes

- The caller supplies an **explicit application root and overlay host**; the host must be part of that app's DOM strategy. An overlay manager only processes interactions within that root or its host.
- Use one `FocusManager` per application for nested scopes. Portal nodes must be detached and in the host document; never move nodes from a compiler-managed keyed/conditional region or from another application owner.
- Native `<button>` is preferred for triggers. Callers provide a visible focus ring and sufficient contrast. Modal focus containment is not suitable for nonmodal popovers. `createDialog` requires an accessible name.
- `createListbox` is **not** a native HTML select replacement: it does not provide platform select UI, form serialization, native validation, touch/mobile assistive technology parity, or multi-select. Pair it with an explicit form field integration.
- Tooltips must not contain interactive descendants. A tooltip is not a dialog, popup menu, or substitute for visible instructions.
- Nested modal inertness is managed within one explicit overlay manager; mixing unrelated overlay managers for nested modal surfaces is unsupported. Background inertness is restored on layer teardown.
- Controlled mode is fixed at creation. To switch modes, dispose and construct a new controller; a controlled request does not mutate the parent-owned Signal.
- Focusability is conservatively inferred from native elements, tabindex, disabled/inert/hidden ancestors and computed visibility. Shadow roots, `<dialog>` top-layer semantics, closed shadow trees, complex radio group ordering, and all assistive-technology combinations require separate certified adapters.

## Verification and release gates

This package requires a reviewed P2 contract, lockfile importer sync, `pnpm` lint/typecheck/build/test, real Chromium/Firefox/WebKit focus/pointer tests, screen reader keyboard review, ESM consumer installation and npm pack verification **before merge and publication**. Source tests are not a substitute for those browser gates. No claim is made that WCAG 2.2 AA certification has occurred.

## Security

No HTML string rendering, unsafe URL handling, model calls, eval, or global event patches. Registrations are explicit and owner-scoped. Caller-provided labels and option text are treated as DOM text, never executable markup.
