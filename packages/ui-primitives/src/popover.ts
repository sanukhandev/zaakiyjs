import type { OwnerScope } from "@zaakiyjs/core";
import { effect } from "@zaakiyjs/signals";
import type { ReadonlySignal } from "@zaakiyjs/signals";
import type { InteractionDetail, ValueChange, ElementController } from "./contracts.js";
import { createControlledState } from "./state.js";
import { createFocusScope } from "./focus.js";
import type { FocusManager } from "./focus.js";
import { listen, own, createRegistration } from "./lifecycle.js";
import type { PrimitiveHandle } from "./lifecycle.js";
import type { OverlayManager } from "./layers.js";

export interface PopoverOptions {
  readonly owner: OwnerScope;
  readonly trigger: HTMLElement;
  readonly content: HTMLElement;
  readonly overlays: OverlayManager;
  readonly focusManager?: FocusManager;
  readonly open?: ReadonlySignal<boolean>;
  readonly defaultOpen?: boolean;
  readonly onOpenChange?: (open: boolean) => void;
  readonly onValueChange?: ValueChange<boolean>;
  readonly autoFocus?: boolean;
  readonly dismissOnOutsidePointer?: boolean;
  readonly dismissOnEscape?: boolean;
}
export interface PopoverController extends ElementController {
  readonly open: ReadonlySignal<boolean>;
  setOpen(open: boolean): void;
}
export function createPopover(options: PopoverOptions): PopoverController {
  const { owner, trigger, content } = options;
  if (!content.id) throw new Error("Popover content needs a stable ID");
  if (!options.overlays.accepts(content)) throw new Error("Popover must belong to its overlay host");
  const prior = {
    hidden: content.hidden, expanded: trigger.getAttribute("aria-expanded"),
    controls: trigger.getAttribute("aria-controls")
  };
  trigger.setAttribute("aria-controls", content.id);
  const state = createControlledState({
    owner, value: options.open, defaultValue: options.defaultOpen ?? false,
    onChange: next => options.onOpenChange?.(next),
    onValueChange: options.onValueChange
  });
  const setOpen = (next: boolean, detail: InteractionDetail = { reason: "programmatic" }) => state.set(next, detail);
  const click = listen(trigger, "click", event => setOpen(!state.value.peek(), {
    reason: event instanceof MouseEvent && event.detail === 0 ? "keyboard" : "pointer",
    originalEvent: event
  }), owner);
  let layer: PrimitiveHandle | null = null;
  let focusRegistration: PrimitiveHandle | null = null;
  const render = effect(() => {
    const open = state.value.value;
    content.hidden = !open;
    trigger.setAttribute("aria-expanded", String(open));
    if (open) {
      layer = options.overlays.add({
        element: content, trigger,
        dismissOnEscape: options.dismissOnEscape ?? true,
        dismissOnOutsidePointer: options.dismissOnOutsidePointer ?? true,
        onDismiss: event => setOpen(false, { reason: "dismiss", originalEvent: event.originalEvent })
      });
      if (options.autoFocus) focusRegistration = createRegistration(owner, activationOwner => {
        const focusScope = createFocusScope({
          container: content, owner: activationOwner,
          manager: options.focusManager ?? options.overlays.focusManager,
          contain: false, restoreFocus: false
        });
        return () => focusScope.dispose();
      });
    }
    return () => {
      layer?.dispose(); layer = null;
      focusRegistration?.dispose(); focusRegistration = null;
      if (content.contains(content.ownerDocument.activeElement) && trigger.isConnected && !owner.disposed) trigger.focus();
    };
  }, { phase: "render" });
  const lifecycle = own(() => {
    render.dispose(); click.dispose();
    content.hidden = prior.hidden;
    if (prior.expanded === null) trigger.removeAttribute("aria-expanded");
    else trigger.setAttribute("aria-expanded", prior.expanded);
    if (prior.controls === null) trigger.removeAttribute("aria-controls");
    else trigger.setAttribute("aria-controls", prior.controls);
  }, owner);
  return { owner, element: content, open: state.value, setOpen, dispose: () => lifecycle.dispose() };
}
