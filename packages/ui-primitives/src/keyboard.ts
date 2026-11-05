import type { OwnerScope } from "@zaakiyjs/core";
import { listen, own, createRegistrationGroup } from "./lifecycle.js";
import type { PrimitiveHandle } from "./lifecycle.js";

export type Orientation = "horizontal" | "vertical" | "both";
export type TextDirection = "ltr" | "rtl";
export interface RovingItem {
  readonly id: string;
  readonly element: HTMLElement;
  readonly disabled?: boolean;
}
export interface RovingOptions {
  readonly container: HTMLElement;
  readonly owner?: OwnerScope;
  readonly orientation?: Orientation;
  readonly direction?: TextDirection;
  readonly wrap?: boolean;
  readonly initialId?: string;
  readonly onActiveChange?: (id: string) => void;
}
export interface RovingController extends PrimitiveHandle {
  register(item: RovingItem): PrimitiveHandle;
  readonly activeId: string | null;
  move(id: string, focus?: boolean): void;
  items(): readonly RovingItem[];
}

export function createRovingFocus(options: RovingOptions): RovingController {
  const map = new Map<string, RovingItem>();
  const registrations = createRegistrationGroup(options.owner);
  let selected: string | null = options.initialId ?? null;
  let closed = false;
  const ordered = () => [...map.values()].sort((a, b) => {
    if (a.element === b.element) return 0;
    const relation = a.element.compareDocumentPosition(b.element);
    if (relation & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
    if (relation & Node.DOCUMENT_POSITION_PRECEDING) return 1;
    return 0;
  });
  const available = () => ordered().filter(x => !x.disabled && !x.element.matches(":disabled") &&
    !x.element.hasAttribute("hidden") && !x.element.closest("[inert]"));
  const sync = () => {
    const viable = available();
    if (!viable.some(x => x.id === selected)) selected = viable[0]?.id ?? null;
    for (const item of map.values()) {
      item.element.tabIndex = item.id === selected && !item.disabled ? 0 : -1;
    }
  };
  const controller: RovingController = {
    get activeId() { return selected; },
    items: ordered,
    register(item) {
      if (closed) throw new Error("Roving controller disposed");
      if (map.has(item.id)) throw new Error("Duplicate item ID: " + item.id);
      if (!options.container.contains(item.element)) throw new Error("Roving item outside container");
      return registrations.add(() => {
        map.set(item.id, item);
        sync();
        return () => {
          if (map.get(item.id) === item) {
            map.delete(item.id);
            item.element.removeAttribute("tabindex");
            sync();
          }
        };
      });
    },
    move(id, focus = true) {
      if (closed) return;
      const item = available().find(x => x.id === id);
      if (!item) return;
      if (selected !== id) {
        selected = id;
        sync();
        options.onActiveChange?.(id);
      }
      if (focus) item.element.focus();
    },
    dispose() { cleanup.dispose(); }
  };
  const onKey = (event: Event) => {
    if (!(event instanceof KeyboardEvent) || event.altKey || event.metaKey || event.ctrlKey) return;
    const items = available();
    if (!items.length) return;
    const current = items.findIndex(x => x.element === event.target || x.id === selected);
    const orientation = options.orientation ?? "horizontal";
    const reverse = options.direction === "rtl" ? -1 : 1;
    let shift = 0;
    if (event.key === "Home") shift = -Infinity;
    else if (event.key === "End") shift = Infinity;
    else if (event.key === "ArrowRight" && orientation !== "vertical") shift = reverse;
    else if (event.key === "ArrowLeft" && orientation !== "vertical") shift = -reverse;
    else if (event.key === "ArrowDown" && orientation !== "horizontal") shift = 1;
    else if (event.key === "ArrowUp" && orientation !== "horizontal") shift = -1;
    else return;
    event.preventDefault();
    const wrap = options.wrap ?? true;
    let index = shift === Infinity ? items.length - 1 : shift === -Infinity ? 0 : current + shift;
    if (wrap) index = ((index % items.length) + items.length) % items.length;
    else index = Math.max(0, Math.min(items.length - 1, index));
    controller.move(items[index]!.id);
  };
  const listener = listen(options.container, "keydown", onKey, options.owner);
  const cleanup = own(() => {
    if (closed) return;
    closed = true;
    listener.dispose();
    registrations.dispose();
    for (const item of map.values()) item.element.removeAttribute("tabindex");
    map.clear();
  }, options.owner);
  return controller;
}
