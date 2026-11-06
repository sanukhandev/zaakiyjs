---
title: "@zaakiyjs/ui-primitives"
description: "Accessible headless controllers for focus, overlays, menus, dialogs and composite widgets"
sidebar_position: 15
---

# @zaakiyjs/ui-primitives

Use UI Primitives to attach tested behavior to existing native elements, without pulling in styles or a JSX renderer.

> **Availability:** Source implementation in ZaakiyJS, not a verified published npm release. The package's manifest at the referenced revision uses `0.0.0`; use workspace tooling until independent publishing is approved.

## At a glance

- **Use it when:** Use headless controllers when you need custom visual design but predictable focus, keyboard and dismissal behavior.
- **Reference revision:** [9f6c6603c98c](https://github.com/sanukhandev/zaakiyjs/commit/9f6c6603c98ca566c2fed6fed34cc770f6a72960).

## Try it in the monorepo

```sh
pnpm --filter @zaakiyjs/ui-primitives typecheck
pnpm --filter @zaakiyjs/ui-primitives test
pnpm --filter @zaakiyjs/ui-primitives build
```

## Feature usage: first working pattern

```ts
import { createOwner, disposeOwner } from '@zaakiyjs/core';
import { createOverlayManager, createDialog } from '@zaakiyjs/ui-primitives';

const owner = createOwner();
const root = document.getElementById('app')!;
const host = document.getElementById('overlays')!;
const panel = document.getElementById('account-dialog')!;
const overlays = createOverlayManager({ root, host, owner });
const dialog = createDialog({
  element: panel, owner, overlays,
  labelledBy: 'account-title', modal: true, defaultOpen: false
});
dialog.setOpen(true);
// When the application unmounts: disposeOwner(owner);
```

## Usage and correctness guidelines

- Controllers require connected existing native DOM nodes and a correctly scoped owner/overlay host.
- Give dialogs an accessible name; maintain keyboard-visible focus indication and contrast in the View.
- No native select/form serialization is implied by a custom listbox, and full screen-reader certification remains separate.

## Public API index

Exported symbols detected in the package root `src/index.ts`. Platform-specific subpaths and structural contracts are explained in the detailed guide and package manifest.

- `Controllable`
- `ControlledState`
- `ControlledStateOptions`
- `DialogController`
- `DialogOptions`
- `DisclosureController`
- `DisclosureOptions`
- `DismissEvent`
- `DismissReason`
- `DismissableLayerOptions`
- `DisposableHandle`
- `ElementController`
- `FocusManager`
- `FocusScopeHandle`
- `FocusScopeOptions`
- `InteractionDetail`
- `InteractionReason`
- `LayerOptions`
- `ListboxController`
- `ListboxOption`
- `ListboxOptions`
- `MenuController`
- `MenuItem`
- `MenuOptions`
- `Orientation`
- `OverlayController`
- `OverlayManager`
- `OverlayManagerOptions`
- `OverlayOptions`
- `OwnedOptions`
- `PopoverController`
- `PopoverOptions`
- `PortalHandle`
- `PortalOptions`
- `PrimitiveHandle`
- `RovingController`
- `RovingItem`
- `RovingOptions`
- `TabDefinition`
- `TabsController`
- `TabsOptions`
- `TextDirection`
- `TooltipController`
- `TooltipOptions`
- `ValueChange`
- `createAccordion`
- `createControlledState`
- `createDialog`
- `createDisclosure`
- `createDismissableLayer`
- `createFocusManager`
- `createFocusScope`
- `createIdScope`
- `createListbox`
- `createMenu`
- `createOverlayController`
- `createOverlayManager`
- `createPopover`
- `createPortal`
- `createRovingFocus`
- `createTabs`
- `createTooltip`
- `focusables`
- `isFocusable`
- `listen`
- `own`
- `ownedTimeout`

## Detailed feature guide

### Runtime dependencies

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

### API overview

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

### Boundary and accessibility notes

- The caller supplies an **explicit application root and overlay host**; the host must be part of that app's DOM strategy. An overlay manager only processes interactions within that root or its host.
- Use one `FocusManager` per application for nested scopes. Portal nodes must be detached and in the host document; never move nodes from a compiler-managed keyed/conditional region or from another application owner.
- Native `<button>` is preferred for triggers. Callers provide a visible focus ring and sufficient contrast. Modal focus containment is not suitable for nonmodal popovers. `createDialog` requires an accessible name.
- `createListbox` is **not** a native HTML select replacement: it does not provide platform select UI, form serialization, native validation, touch/mobile assistive technology parity, or multi-select. Pair it with an explicit form field integration.
- Tooltips must not contain interactive descendants. A tooltip is not a dialog, popup menu, or substitute for visible instructions.
- Nested modal inertness is managed within one explicit overlay manager; mixing unrelated overlay managers for nested modal surfaces is unsupported. Background inertness is restored on layer teardown.
- Controlled mode is fixed at creation. To switch modes, dispose and construct a new controller; a controlled request does not mutate the parent-owned Signal.
- Focusability is conservatively inferred from native elements, tabindex, disabled/inert/hidden ancestors and computed visibility. Shadow roots, `<dialog>` top-layer semantics, closed shadow trees, complex radio group ordering, and all assistive-technology combinations require separate certified adapters.

### Verification and release gates

Validation covers package lint/typecheck/build/test and browser-oriented fixtures. Independently verify current required CI checks, screen-reader keyboard interaction, packaged consumer installation and npm metadata **before publication**. Source tests do not establish WCAG 2.2 AA certification.

### Security

No HTML string rendering, unsafe URL handling, model calls, eval, or global event patches. Registrations are explicit and owner-scoped. Caller-provided labels and option text are treated as DOM text, never executable markup.

### Frozen P2 Contract 09 and API compatibility

- The public `InteractionDetail`, `ValueChange<T>`, `Controllable<T>` and `ElementController` types carry typed state transitions. The legacy `onOpenChange` / `onSelectionChange` callbacks remain for older call sites; `onValueChange` reports the interaction reason and native event.
- `createDismissableLayer` and `createOverlayController` resolve the application manager from the Core owner context, or accept an explicit `overlays` override. No process-global component stack is used. One overlay manager per root owner is the intended default.
- A supplied native `<dialog>` uses `showModal()` / `show()` when available. An ordinary HTML element uses a role-based accessible adapter with focus/keyboard/inertness management. Controllers must attach to elements in the explicit overlay host.
- Nested dialogs share their overlay manager's focus stack by default. Plain focus scopes should receive a shared `FocusManager` to support nesting; use `trapFocus` (legacy alias `contain`).
- Scroll and inert browser resources are reference-counted by document/element and fully restored after modal dismissal or removal. `lockScroll: false` disables document scroll locking. `outsideBoundary: "application"` (default) prevents event leakage into other roots; `"document"` deliberately enables document-wide outside dismissal.
- Portal nodes must be detached in the same document. Portal handles expose `owner`, `host`, and `nodes`; externally removed hosts trigger cleanup. Moving compiler-owned region nodes into portals is unsupported.

## Integrate with neighboring packages

- [@zaakiyjs/ui](./ui.md)
- [@zaakiyjs/core](./core.md)
- [@zaakiyjs/dom](./dom.md)
- [@zaakiyjs/motion](./motion.md)

## Source and maintenance

- [Package README](https://github.com/sanukhandev/zaakiyjs/blob/9f6c6603c98ca566c2fed6fed34cc770f6a72960/packages/ui-primitives/README.md)
- [Public source exports](https://github.com/sanukhandev/zaakiyjs/blob/9f6c6603c98ca566c2fed6fed34cc770f6a72960/packages/ui-primitives/src/index.ts)
- [Package test cases](https://github.com/sanukhandev/zaakiyjs/tree/9f6c6603c98ca566c2fed6fed34cc770f6a72960/packages/ui-primitives/test)
- Update this page when public APIs, runtime semantics or platform guarantees change.
