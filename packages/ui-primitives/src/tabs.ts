import type { OwnerScope } from "@zaakiyjs/core";
import { effect } from "@zaakiyjs/signals";
import type { ReadonlySignal } from "@zaakiyjs/signals";
import { createControlledState } from "./state.js";
import { createRovingFocus } from "./keyboard.js";
import type { Orientation, TextDirection } from "./keyboard.js";
import { listen, own } from "./lifecycle.js";
import type { PrimitiveHandle } from "./lifecycle.js";

export interface TabDefinition {
  readonly id: string;
  readonly tab: HTMLElement;
  readonly panel: HTMLElement;
  readonly disabled?: boolean;
}
export interface TabsOptions {
  readonly list: HTMLElement;
  readonly owner: OwnerScope;
  readonly value?: ReadonlySignal<string>;
  readonly defaultValue: string;
  readonly onChange?: (id: string) => void;
  readonly activation?: "automatic" | "manual";
  readonly orientation?: Exclude<Orientation, "both">;
  readonly direction?: TextDirection;
}
export interface TabsController extends PrimitiveHandle {
  readonly selected: ReadonlySignal<string>;
  register(tab: TabDefinition): PrimitiveHandle;
  select(id: string): void;
}
export function createTabs(options: TabsOptions): TabsController {
  const { owner, list } = options;
  list.setAttribute("role", "tablist");
  list.setAttribute("aria-orientation", options.orientation ?? "horizontal");
  const state = createControlledState({
    owner, value: options.value, defaultValue: options.defaultValue,
    onChange: next => options.onChange?.(next)
  });
  const registered = new Map<string, TabDefinition>();
  const roving = createRovingFocus({
    container: list, owner, initialId: options.defaultValue,
    orientation: options.orientation ?? "horizontal", direction: options.direction,
    onActiveChange: id => { if ((options.activation ?? "automatic") === "automatic") select(id); }
  });
  const select = (id: string) => {
    const item = registered.get(id);
    if (item && !item.disabled && !item.tab.matches(":disabled")) state.set(id);
  };
  const keys = listen(list, "keydown", (event: Event) => {
    if (!(event instanceof KeyboardEvent) || !["Enter", " "].includes(event.key)) return;
    const current = [...registered.values()].find(x => x.tab === event.target);
    if (!current || current.disabled) return;
    event.preventDefault();
    select(current.id);
  }, owner);
  const rendered = effect(() => {
    const selected = state.value.value;
    if (registered.has(selected)) roving.move(selected, false);
    for (const item of registered.values()) {
      const active = item.id === selected;
      item.tab.setAttribute("aria-selected", String(active));
      item.panel.hidden = !active;
      item.tab.tabIndex = active ? 0 : -1;
    }
  }, { phase: "render" });
  const sync = () => {
    const selected = state.value.peek();
    for (const item of registered.values()) {
      item.tab.setAttribute("aria-selected", String(item.id === selected));
      item.panel.hidden = item.id !== selected;
    }
  };
  const lifecycle = own(() => {
    rendered.dispose(); keys.dispose(); roving.dispose();
    for (const item of registered.values()) {
      item.tab.removeAttribute("role"); item.tab.removeAttribute("aria-selected");
      item.tab.removeAttribute("aria-controls"); item.panel.removeAttribute("role");
      item.panel.removeAttribute("aria-labelledby"); item.tab.removeAttribute("tabindex");
      item.panel.hidden = false;
    }
    registered.clear();
    list.removeAttribute("role"); list.removeAttribute("aria-orientation");
  }, owner);
  return {
    selected: state.value, select, dispose: () => lifecycle.dispose(),
    register(item) {
      if (registered.has(item.id) || [...registered.values()].some(x => x.tab === item.tab ||
          x.panel === item.panel)) throw new Error("Duplicate tab identity");
      if (!list.contains(item.tab) || !item.tab.id || !item.panel.id) {
        throw new Error("Tab and panel require stable IDs and tablist membership");
      }
      registered.set(item.id, item);
      item.tab.setAttribute("role", "tab");
      item.panel.setAttribute("role", "tabpanel");
      item.tab.setAttribute("aria-controls", item.panel.id);
      item.panel.setAttribute("aria-labelledby", item.tab.id);
      item.tab.setAttribute("aria-disabled", String(!!item.disabled));
      const registration = roving.register({ id: item.id, element: item.tab, disabled: item.disabled });
      sync();
      return own(() => {
        registration.dispose(); registered.delete(item.id);
        item.tab.removeAttribute("role"); item.tab.removeAttribute("aria-selected");
        item.tab.removeAttribute("aria-controls"); item.tab.removeAttribute("aria-disabled");
        item.panel.removeAttribute("role"); item.panel.removeAttribute("aria-labelledby");
        item.panel.hidden = false;
      }, owner);
    }
  };
}
