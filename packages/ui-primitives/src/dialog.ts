import type { OwnerScope } from "@zaakiyjs/core";
import { effect } from "@zaakiyjs/signals";
import type { ReadonlySignal } from "@zaakiyjs/signals";
import { createControlledState } from "./state.js";
import { createFocusScope } from "./focus.js";
import type { FocusManager, FocusScopeHandle } from "./focus.js";
import { own } from "./lifecycle.js";
import type { PrimitiveHandle } from "./lifecycle.js";
import type { OverlayManager, DismissReason } from "./layers.js";

export interface DialogOptions {
  readonly element: HTMLElement;
  readonly owner: OwnerScope;
  readonly overlays: OverlayManager;
  readonly focusManager?: FocusManager;
  readonly modal?: boolean;
  readonly open?: ReadonlySignal<boolean>;
  readonly defaultOpen?: boolean;
  readonly onOpenChange?: (open: boolean, reason: "programmatic" | DismissReason) => void;
  readonly escapeDismiss?: boolean;
  readonly outsidePointerDismiss?: boolean;
  readonly restoreFocus?: boolean;
  readonly initialFocus?: HTMLElement | (() => HTMLElement | null);
  readonly labelledBy?: string;
  readonly describedBy?: string;
  readonly ariaLabel?: string;
}
export interface DialogController extends PrimitiveHandle {
  readonly open: ReadonlySignal<boolean>;
  setOpen(value: boolean): void;
}
export function createDialog(options: DialogOptions): DialogController {
  const { element, owner, overlays } = options;
  if (owner.disposed) throw new Error("Cannot attach dialog to a disposed owner");
  if (!options.ariaLabel && !options.labelledBy &&
    !element.hasAttribute("aria-label") && !element.hasAttribute("aria-labelledby")) {
    throw new Error("Dialog must have an accessible name");
  }
  const attributes = ["role", "aria-modal", "aria-label", "aria-labelledby", "aria-describedby"];
  const prior = new Map(attributes.map(name => [name, element.getAttribute(name)]));
  const priorHidden = element.hidden;
  element.setAttribute("role", "dialog");
  if (options.ariaLabel) element.setAttribute("aria-label", options.ariaLabel);
  if (options.labelledBy) element.setAttribute("aria-labelledby", options.labelledBy);
  if (options.describedBy) element.setAttribute("aria-describedby", options.describedBy);
  if (options.modal ?? true) element.setAttribute("aria-modal", "true");
  else element.removeAttribute("aria-modal");
  let requestedReason: "programmatic" | DismissReason = "programmatic";
  const state = createControlledState({
    owner, value: options.open, defaultValue: options.defaultOpen ?? false,
    onChange(next) { options.onOpenChange?.(next, requestedReason); }
  });
  const setOpen = (next: boolean, reason: "programmatic" | DismissReason = "programmatic") => {
    requestedReason = reason;
    try { state.set(next); } finally { requestedReason = "programmatic"; }
  };
  let focusScope: FocusScopeHandle | null = null;
  let layer: PrimitiveHandle | null = null;
  const active = effect(() => {
    const visible = state.value.value;
    element.hidden = !visible;
    if (visible) {
      layer = overlays.add({
        element, modal: options.modal ?? true,
        dismissOnEscape: options.escapeDismiss ?? true,
        dismissOnOutsidePointer: options.outsidePointerDismiss ?? false,
        onDismiss: event => setOpen(false, event.reason)
      });
      focusScope = createFocusScope({
        owner, container: element, manager: options.focusManager ?? overlays.focusManager,
        contain: options.modal ?? true, restoreFocus: options.restoreFocus ?? true,
        initialFocus: options.initialFocus
      });
    }
    return () => {
      // Restore accessibility of the background before returning focus.
      layer?.dispose(); layer = null;
      focusScope?.dispose(); focusScope = null;
    };
  }, { phase: "render" });
  const lifecycle = own(() => {
    active.dispose();
    element.hidden = priorHidden;
    for (const [name, value] of prior) {
      if (value === null) element.removeAttribute(name);
      else element.setAttribute(name, value);
    }
  }, owner);
  return { open: state.value, setOpen, dispose: () => lifecycle.dispose() };
}
