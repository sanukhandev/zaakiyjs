import type { OwnerScope } from "@zaakiyjs/core";
import { effect } from "@zaakiyjs/signals";
import type { ReadonlySignal } from "@zaakiyjs/signals";
import type { InteractionDetail, ValueChange, ElementController } from "./contracts.js";
import { createControlledState } from "./state.js";
import { listen, own, createRegistrationGroup } from "./lifecycle.js";
import type { PrimitiveHandle } from "./lifecycle.js";

export interface ListboxOption {
  readonly id: string;
  readonly element: HTMLElement;
  readonly textValue?: string;
  readonly disabled?: boolean;
}
export interface ListboxOptions {
  readonly owner: OwnerScope;
  readonly element: HTMLElement;
  readonly selected?: ReadonlySignal<string | null>;
  readonly defaultSelected?: string | null;
  readonly onSelectionChange?: (value: string | null) => void;
  readonly onValueChange?: ValueChange<string | null>;
  readonly readonly?: boolean;
  readonly disabled?: boolean;
  readonly orientation?: "horizontal" | "vertical";
  readonly selectOnFocus?: boolean;
}
export interface ListboxController extends ElementController {
  readonly selected: ReadonlySignal<string | null>;
  readonly activeId: string | null;
  register(option: ListboxOption): PrimitiveHandle;
  activate(id: string): void;
  select(id: string | null): void;
}
export function createListbox(options: ListboxOptions): ListboxController {
  const { element, owner } = options;
  const former = {
    role: element.getAttribute("role"), tab: element.getAttribute("tabindex"),
    active: element.getAttribute("aria-activedescendant"), orientation: element.getAttribute("aria-orientation")
  };
  element.setAttribute("role", "listbox");
  element.setAttribute("aria-orientation", options.orientation ?? "vertical");
  if (!element.hasAttribute("tabindex")) element.tabIndex = 0;
  const selection = createControlledState({
    owner, value: options.selected, defaultValue: options.defaultSelected ?? null,
    onChange: next => options.onSelectionChange?.(next),
    onValueChange: options.onValueChange
  });
  const items = new Map<string, ListboxOption>();
  const registrations = createRegistrationGroup(owner);
  let active: string | null = null;
  let buffer = "";
  let lastType = 0;
  const ordered = () => [...items.values()].sort((a, b) => {
    const pos = a.element.compareDocumentPosition(b.element);
    return pos & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : pos & Node.DOCUMENT_POSITION_PRECEDING ? 1 : 0;
  });
  const eligible = () => ordered().filter(x =>
    !x.disabled && !x.element.matches(":disabled") && !x.element.hasAttribute("hidden") &&
    !x.element.closest("[inert]"));
  const sync = () => {
    for (const item of items.values()) {
      item.element.setAttribute("aria-selected", String(item.id === selection.value.peek()));
    }
    if (!eligible().some(x => x.id === active)) active = eligible()[0]?.id ?? null;
    const current = active ? items.get(active) : undefined;
    if (current) element.setAttribute("aria-activedescendant", current.element.id);
    else element.removeAttribute("aria-activedescendant");
  };
  const select = (id: string | null, detail: InteractionDetail = { reason: "programmatic" }) => {
    if (options.readonly || options.disabled || (id !== null && !eligible().some(x => x.id === id))) return;
    selection.set(id, detail);
    sync();
  };
  const activate = (id: string) => {
    if (options.disabled || !eligible().some(x => x.id === id)) return;
    active = id;
    sync();
    if (options.selectOnFocus) select(id);
  };
  const keydown = listen(element, "keydown", (event: Event) => {
    if (!(event instanceof KeyboardEvent) || event.altKey || event.ctrlKey || event.metaKey ||
      event.target !== element || event.isComposing) return;
    const all = eligible();
    if (!all.length || options.disabled) return;
    const current = all.findIndex(x => x.id === active);
    let next: number | null = null;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = all.length - 1;
    if (event.key === "ArrowDown" && options.orientation !== "horizontal") next = Math.min(all.length - 1, current + 1);
    if (event.key === "ArrowUp" && options.orientation !== "horizontal") next = Math.max(0, current - 1);
    if (event.key === "ArrowRight" && options.orientation === "horizontal") next = Math.min(all.length - 1, current + 1);
    if (event.key === "ArrowLeft" && options.orientation === "horizontal") next = Math.max(0, current - 1);
    if (next !== null) {
      event.preventDefault(); activate(all[next]!.id); return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (active) select(active, { reason: "keyboard", originalEvent: event });
      return;
    }
    if (event.key.length === 1 && /\S/.test(event.key)) {
      const now = Date.now();
      buffer = now - lastType > 650 ? event.key.toLocaleLowerCase() : buffer + event.key.toLocaleLowerCase();
      lastType = now;
      const match = all.find(item => (item.textValue ?? item.element.textContent ?? "")
        .trim().toLocaleLowerCase().startsWith(buffer));
      if (match) { event.preventDefault(); activate(match.id); }
    }
  }, owner);
  const rendering = effect(() => {
    void selection.value.value;
    sync();
  }, { phase: "render" });
  const lifecycle = own(() => {
    rendering.dispose(); keydown.dispose(); registrations.dispose();
    for (const item of items.values()) {
      item.element.removeAttribute("role"); item.element.removeAttribute("aria-selected");
      item.element.removeAttribute("aria-disabled");
    }
    items.clear();
    for (const [key, value] of [
      ["role", former.role], ["tabindex", former.tab],
      ["aria-activedescendant", former.active], ["aria-orientation", former.orientation]
    ] as const) {
      if (value === null) element.removeAttribute(key); else element.setAttribute(key, value);
    }
  }, owner);
  return {
    owner, element,
    get activeId() { return active; },
    selected: selection.value, select, activate, dispose: () => lifecycle.dispose(),
    register(item) {
      if (!item.element.id || items.has(item.id) ||
        [...items.values()].some(x => x.element.id === item.element.id)) {
        throw new Error("Listbox options require unique stable DOM and logical IDs");
      }
      if (!element.contains(item.element)) throw new Error("Option outside listbox");
      return registrations.add(registrationOwner => {
        items.set(item.id, item);
        item.element.setAttribute("role", "option");
        item.element.setAttribute("aria-disabled", String(!!item.disabled));
        const pointer = listen(item.element, "click", () => {
          if (item.disabled) return;
          activate(item.id); select(item.id, { reason: "pointer" });
        }, registrationOwner);
        sync();
        return () => {
          pointer.dispose(); items.delete(item.id);
          item.element.removeAttribute("role"); item.element.removeAttribute("aria-selected");
          item.element.removeAttribute("aria-disabled");
          sync();
        };
      });
    }
  };
}
