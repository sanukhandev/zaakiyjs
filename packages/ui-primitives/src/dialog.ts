import type { OwnerScope } from "@zaakiyjs/core";
import { effect } from "@zaakiyjs/signals";
import type { ReadonlySignal } from "@zaakiyjs/signals";
import type { InteractionDetail, ValueChange, ElementController } from "./contracts.js";
import { createControlledState } from "./state.js";
import { createFocusScope } from "./focus.js";
import type { FocusManager, FocusScopeHandle } from "./focus.js";
import { listen, own } from "./lifecycle.js";
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
  readonly onValueChange?: ValueChange<boolean>;
  readonly escapeDismiss?: boolean;
  readonly outsidePointerDismiss?: boolean;
  readonly restoreFocus?: boolean;
  readonly initialFocus?: HTMLElement | (() => HTMLElement | null);
  readonly labelledBy?: string;
  readonly describedBy?: string;
  readonly ariaLabel?: string;
}
export interface DialogController extends ElementController {
  readonly open: ReadonlySignal<boolean>;
  setOpen(value: boolean): void;
}
export function createDialog(options: DialogOptions): DialogController {
  const { element, owner, overlays } = options;
  if (owner.disposed) throw new Error("Cannot attach dialog to a disposed owner");
  if (!overlays.accepts(element)) throw new Error("Dialog must belong to its application overlay host");
  if (options.open && !options.onOpenChange && !options.onValueChange) {
    throw new Error("Controlled dialog must provide an onOpenChange/onValueChange callback");
  }
  if (!options.ariaLabel && !options.labelledBy &&
    !element.hasAttribute("aria-label") && !element.hasAttribute("aria-labelledby")) {
    throw new Error("Dialog must have an accessible name");
  }
  const native = element.tagName === "DIALOG" ? element as HTMLDialogElement : null;
  const wasNativeOpen = native?.open ?? false;
  const attributes = ["role", "aria-modal", "aria-label", "aria-labelledby", "aria-describedby"];
  const prior = new Map(attributes.map(name => [name, element.getAttribute(name)]));
  const priorHidden = element.hidden;
  const restoreAttributes = () => {
    for (const [name, value] of prior) {
      if (value === null) element.removeAttribute(name);
      else element.setAttribute(name, value);
    }
  };
  // Native <dialog> already has implicit role=dialog.
  if (!native) element.setAttribute("role", "dialog");
  if (options.ariaLabel) element.setAttribute("aria-label", options.ariaLabel);
  if (options.labelledBy) element.setAttribute("aria-labelledby", options.labelledBy);
  if (options.describedBy) element.setAttribute("aria-describedby", options.describedBy);
  if (options.modal ?? true) element.setAttribute("aria-modal", "true");
  else element.removeAttribute("aria-modal");

  let requestedReason: "programmatic" | DismissReason = "programmatic";
  const state = createControlledState({
    owner, value: options.open, defaultValue: options.defaultOpen ?? false,
    onChange(next) { options.onOpenChange?.(next, requestedReason); },
    onValueChange: options.onValueChange
  });
  const setOpen = (next: boolean, reason: "programmatic" | DismissReason = "programmatic", originalEvent?: Event) => {
    requestedReason = reason;
    const detail: InteractionDetail = { reason: reason === "programmatic" ? "programmatic" : "dismiss", originalEvent };
    try { state.set(next, detail); } finally { requestedReason = "programmatic"; }
  };
  const showNative = () => {
    if (!native || native.open) return;
    if ((options.modal ?? true) && typeof native.showModal === "function") native.showModal();
    else if (typeof native.show === "function") native.show();
    else native.setAttribute("open", "");
  };
  const hideNative = () => {
    if (!native?.open) return;
    if (typeof native.close === "function") native.close();
    else native.removeAttribute("open");
  };
  let focusScope: FocusScopeHandle | null = null;
  let layer: PrimitiveHandle | null = null;
  const release = () => {
    // The top-level inertness is cleared before restoration is attempted.
    layer?.dispose(); layer = null;
    focusScope?.dispose(); focusScope = null;
    hideNative();
  };
  let cancel: PrimitiveHandle | null = null;
  try {
    if (native) {
      cancel = listen(native, "cancel", event => {
        event.preventDefault();
        if (options.escapeDismiss !== false) setOpen(false, "escape", event);
      }, owner);
    }
    const active = effect(() => {
      const visible = state.value.value;
      if (!visible) {
        element.hidden = true;
        hideNative();
        return;
      }
      element.hidden = false;
      try {
        showNative();
        layer = overlays.add({
          element, modal: options.modal ?? true,
          dismissOnEscape: options.escapeDismiss ?? true,
          dismissOnOutsidePointer: options.outsidePointerDismiss ?? false,
          onDismiss: event => setOpen(false, event.reason, event.originalEvent)
        });
        focusScope = createFocusScope({
          owner, container: element, manager: options.focusManager ?? overlays.focusManager,
          trapFocus: options.modal ?? true, restoreFocus: options.restoreFocus ?? true,
          initialFocus: options.initialFocus
        });
      } catch (error) {
        release();
        element.hidden = true;
        throw error;
      }
      return release;
    }, { phase: "render" });
    const lifecycle = own(() => {
      active.dispose();
      cancel?.dispose();
      element.hidden = priorHidden;
      if (native && wasNativeOpen && !native.open) native.setAttribute("open", "");
      restoreAttributes();
    }, owner);
    return { owner, element, open: state.value, setOpen, dispose: () => lifecycle.dispose() };
  } catch (error) {
    release();
    cancel?.dispose();
    element.hidden = priorHidden;
    if (native && wasNativeOpen && !native.open) native.setAttribute("open", "");
    restoreAttributes();
    throw error;
  }
}
