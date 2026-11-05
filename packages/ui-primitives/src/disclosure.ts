import type { OwnerScope } from "@zaakiyjs/core";
import { effect } from "@zaakiyjs/signals";
import type { ReadonlySignal } from "@zaakiyjs/signals";
import type { InteractionDetail, ValueChange, ElementController } from "./contracts.js";
import { createControlledState } from "./state.js";
import { listen, own, createRegistrationGroup } from "./lifecycle.js";
import type { PrimitiveHandle } from "./lifecycle.js";

export interface DisclosureOptions {
  readonly trigger: HTMLElement;
  readonly panel: HTMLElement;
  readonly owner: OwnerScope;
  readonly expanded?: ReadonlySignal<boolean>;
  readonly defaultExpanded?: boolean;
  readonly disabled?: boolean;
  readonly readonly?: boolean;
  readonly onExpandedChange?: (value: boolean) => void;
  readonly onValueChange?: ValueChange<boolean>;
}
export interface DisclosureController extends ElementController {
  readonly expanded: ReadonlySignal<boolean>;
  setExpanded(value: boolean): void;
}
export function createDisclosure(options: DisclosureOptions): DisclosureController {
  const { trigger, panel, owner } = options;
  if (!panel.id) throw new Error("Disclosure panel must have a stable ID");
  if (!["BUTTON", "SUMMARY"].includes(trigger.tagName) && trigger.getAttribute("role") !== "button") {
    throw new Error("Disclosure trigger must use a native button or keyboard-operable button semantics");
  }
  const previous = {
    controls: trigger.getAttribute("aria-controls"),
    expanded: trigger.getAttribute("aria-expanded"),
    disabled: trigger.getAttribute("aria-disabled"),
    hidden: panel.hidden
  };
  trigger.setAttribute("aria-controls", panel.id);
  if (options.disabled) trigger.setAttribute("aria-disabled", "true");
  const state = createControlledState({
    owner, value: options.expanded, defaultValue: options.defaultExpanded ?? false,
    onChange: next => options.onExpandedChange?.(next),
    onValueChange: options.onValueChange
  });
  const setExpanded = (next: boolean, detail: InteractionDetail = { reason: "programmatic" }) => {
    if (options.disabled || options.readonly) return;
    state.set(next, detail);
  };
  const update = effect(() => {
    const expanded = state.value.value;
    trigger.setAttribute("aria-expanded", String(expanded));
    panel.hidden = !expanded;
  }, { phase: "render" });
  const click = listen(trigger, "click", event => setExpanded(!state.value.peek(), {
    reason: event instanceof MouseEvent && event.detail === 0 ? "keyboard" : "pointer",
    originalEvent: event
  }), owner);
  const key = listen(trigger, "keydown", (event: Event) => {
    if (!(event instanceof KeyboardEvent) || trigger.tagName === "BUTTON" || trigger.tagName === "SUMMARY") return;
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    setExpanded(!state.value.peek(), { reason: "keyboard", originalEvent: event });
  }, owner);
  const lifecycle = own(() => {
    update.dispose(); click.dispose(); key.dispose();
    for (const [name, before] of [["aria-controls", previous.controls], ["aria-expanded", previous.expanded],
      ["aria-disabled", previous.disabled]] as const) {
      if (before === null) trigger.removeAttribute(name);
      else trigger.setAttribute(name, before);
    }
    panel.hidden = previous.hidden;
  }, owner);
  return { owner, element: trigger, expanded: state.value, setExpanded, dispose: () => lifecycle.dispose() };
}
/** Accordion composition: independent disclosure state; no duplicate state scheduler. */
export function createAccordion(options: {
  readonly owner: OwnerScope;
  readonly multiple?: boolean;
}): { add(disclosure: DisclosureController): PrimitiveHandle; dispose(): void } {
  const members = new Map<DisclosureController, PrimitiveHandle>();
  const registrations = createRegistrationGroup(options.owner);
  let closed = false;
  const cleanup = own(() => {
    closed = true;
    registrations.dispose();
    members.clear();
  }, options.owner);
  return {
    add(disclosure) {
      if (closed) throw new Error("Accordion disposed");
      if (members.has(disclosure)) throw new Error("Disclosure already registered");
      return registrations.add(() => {
        const watcher = effect(() => {
          if (options.multiple || !disclosure.expanded.value || closed) return;
          for (const other of members.keys()) {
            if (other !== disclosure && other.expanded.peek()) other.setExpanded(false);
          }
        });
        members.set(disclosure, watcher);
        return () => {
          watcher.dispose();
          members.delete(disclosure);
        };
      });
    },
    dispose: () => cleanup.dispose()
  };
}
