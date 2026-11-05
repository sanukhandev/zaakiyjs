import type { OwnerScope } from "@zaakiyjs/core";
import { effect } from "@zaakiyjs/signals";
import type { ReadonlySignal } from "@zaakiyjs/signals";
import type { InteractionDetail, ValueChange } from "./contracts.js";
import { createControlledState } from "./state.js";
import { createRovingFocus } from "./keyboard.js";
import { listen, own, createRegistrationGroup } from "./lifecycle.js";
import type { PrimitiveHandle } from "./lifecycle.js";
import type { OverlayManager } from "./layers.js";

export interface MenuOptions {
  readonly owner: OwnerScope;
  readonly trigger: HTMLElement;
  readonly content: HTMLElement;
  readonly overlays: OverlayManager;
  readonly open?: ReadonlySignal<boolean>;
  readonly defaultOpen?: boolean;
  readonly onOpenChange?: (open: boolean) => void;
  readonly onValueChange?: ValueChange<boolean>;
  readonly direction?: "ltr" | "rtl";
}
export interface MenuItem {
  readonly id: string;
  readonly element: HTMLElement;
  readonly disabled?: boolean;
  readonly onSelect?: () => void;
}
export interface MenuController extends PrimitiveHandle {
  readonly open: ReadonlySignal<boolean>;
  setOpen(next: boolean): void;
  register(item: MenuItem): PrimitiveHandle;
}
export function createMenu(options: MenuOptions): MenuController {
  const { owner, trigger, content } = options;
  if (!content.id) throw new Error("Menu requires a content ID");
  const former = {
    role: content.getAttribute("role"), hidden: content.hidden,
    expanded: trigger.getAttribute("aria-expanded"),
    controls: trigger.getAttribute("aria-controls"),
    popup: trigger.getAttribute("aria-haspopup")
  };
  content.setAttribute("role", "menu");
  trigger.setAttribute("aria-haspopup", "menu");
  trigger.setAttribute("aria-controls", content.id);
  const items = new Map<string, MenuItem>();
  const registrations = createRegistrationGroup(owner);
  const state = createControlledState({
    owner, value: options.open, defaultValue: options.defaultOpen ?? false,
    onChange: next => options.onOpenChange?.(next),
    onValueChange: options.onValueChange
  });
  const roving = createRovingFocus({
    container: content, owner, orientation: "vertical", direction: options.direction
  });
  const setOpen = (next: boolean, detail: InteractionDetail = { reason: "programmatic" }) => state.set(next, detail);
  const triggerClick = listen(trigger, "click", event => setOpen(!state.value.peek(), {
    reason: event instanceof MouseEvent && event.detail === 0 ? "keyboard" : "pointer",
    originalEvent: event
  }), owner);
  const triggerKeys = listen(trigger, "keydown", (event: Event) => {
    if (!(event instanceof KeyboardEvent) || !["ArrowDown", "ArrowUp"].includes(event.key)) return;
    event.preventDefault(); setOpen(true, { reason: "keyboard", originalEvent: event });
  }, owner);
  const itemKeys = listen(content, "keydown", (event: Event) => {
    if (!(event instanceof KeyboardEvent) || !["Enter", " "].includes(event.key)) return;
    const item = [...items.values()].find(x => x.element === event.target ||
      (event.target instanceof Node && x.element.contains(event.target)));
    if (!item || item.disabled || item.element.matches(":disabled")) return;
    event.preventDefault();
    item.onSelect?.();
    setOpen(false, { reason: "keyboard", originalEvent: event });
  }, owner);
  let layer: PrimitiveHandle | null = null;
  const rendering = effect(() => {
    const opened = state.value.value;
    content.hidden = !opened;
    trigger.setAttribute("aria-expanded", String(opened));
    if (opened) {
      layer = options.overlays.add({
        element: content, trigger, dismissOnEscape: true, dismissOnOutsidePointer: true,
        onDismiss: event => setOpen(false, { reason: "dismiss", originalEvent: event.originalEvent })
      });
      const first = roving.items().find(x => !x.disabled && !x.element.matches(":disabled"));
      first?.element.focus();
    }
    return () => {
      layer?.dispose(); layer = null;
      if (content.contains(content.ownerDocument.activeElement) && trigger.isConnected && !owner.disposed) {
        trigger.focus();
      }
    };
  }, { phase: "render" });
  const cleanup = own(() => {
    rendering.dispose(); registrations.dispose(); roving.dispose();
    itemKeys.dispose(); triggerKeys.dispose(); triggerClick.dispose();
    for (const item of items.values()) {
      item.element.removeAttribute("role"); item.element.removeAttribute("aria-disabled");
    }
    items.clear();
    content.hidden = former.hidden;
    for (const [element, name, value] of [
      [content, "role", former.role], [trigger, "aria-expanded", former.expanded],
      [trigger, "aria-controls", former.controls], [trigger, "aria-haspopup", former.popup]
    ] as const) {
      if (value === null) element.removeAttribute(name); else element.setAttribute(name, value);
    }
  }, owner);
  return {
    open: state.value, setOpen, dispose: () => cleanup.dispose(),
    register(item) {
      if (items.has(item.id)) throw new Error("Duplicate menu item ID");
      return registrations.add(registrationOwner => {
        items.set(item.id, item);
        item.element.setAttribute("role", "menuitem");
        item.element.setAttribute("aria-disabled", String(!!item.disabled));
        const itemRoving = roving.register({ id: item.id, element: item.element, disabled: item.disabled });
        const click = listen(item.element, "click", (event: Event) => {
          if (item.disabled || item.element.matches(":disabled")) {
            event.preventDefault(); return;
          }
          item.onSelect?.(); setOpen(false, { reason: "pointer", originalEvent: event });
        }, registrationOwner);
        return () => {
          click.dispose(); itemRoving.dispose(); items.delete(item.id);
          item.element.removeAttribute("role"); item.element.removeAttribute("aria-disabled");
        };
      });
    }
  };
}
