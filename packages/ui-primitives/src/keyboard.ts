import type { OwnerScope } from "@zaakiyjs/core";
import type { InteractionDetail } from "./contracts.js";
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
  readonly owner: OwnerScope;
  readonly items?: () => readonly HTMLElement[];
  readonly orientation?: Orientation;
  readonly direction?: TextDirection;
  readonly wrap?: boolean;
  readonly loop?: boolean;
  readonly initialId?: string;
  readonly onActiveChange?: (id: string, detail: InteractionDetail) => void;
}
export interface RovingController extends PrimitiveHandle {
  readonly owner: OwnerScope;
  readonly element: HTMLElement;
  register(item: RovingItem): PrimitiveHandle;
  readonly activeId: string | null;
  move(id: string, focus?: boolean, detail?: InteractionDetail): void;
  items(): readonly RovingItem[];
}

export function createRovingFocus(options: RovingOptions): RovingController {
  if (!options.owner || options.owner.disposed) throw new Error("Roving focus needs a live Core owner");
  const map = new Map<string, RovingItem>();
  const registrations = createRegistrationGroup(options.owner);
  let selected: string | null = options.initialId ?? null;
  let closed = false;
  // Initial items have no external observers before the constructor returns.
  // One synchronization after registration avoids repeated full DOM sorts and
  // computed-style checks for every prefix of a large item list.
  let loadingInitial = true;
  const ordered = () => [...map.values()].sort((a, b) => {
    if (a.element === b.element) return 0;
    const relation = a.element.compareDocumentPosition(b.element);
    if (relation & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
    if (relation & Node.DOCUMENT_POSITION_PRECEDING) return 1;
    return 0;
  });
  const available = () => ordered().filter(item => {
    const el = item.element;
    if (item.disabled || el.matches(":disabled") || el.getAttribute("aria-disabled") === "true" ||
      !el.isConnected || !options.container.contains(el)) return false;
    for (let ancestor: Element | null = el; ancestor; ancestor = ancestor.parentElement) {
      if (ancestor.hasAttribute("hidden") || ancestor.hasAttribute("inert") ||
        ancestor.getAttribute("aria-hidden") === "true") return false;
      const style = ancestor.ownerDocument.defaultView?.getComputedStyle(ancestor);
      if (style?.display === "none" || style?.visibility === "hidden" ||
        style?.visibility === "collapse") return false;
      if (ancestor === options.container) break;
    }
    return true;
  });
  const sync = () => {
    const viable = available();
    if (!viable.some(x => x.id === selected)) selected = viable[0]?.id ?? null;
    for (const item of map.values()) {
      item.element.tabIndex = item.id === selected && !item.disabled ? 0 : -1;
    }
  };
  const controller: RovingController = {
    owner: options.owner,
    element: options.container,
    get activeId() { return selected; },
    items: ordered,
    register(item) {
      if (closed) throw new Error("Roving controller disposed");
      if (map.has(item.id)) throw new Error("Duplicate item ID: " + item.id);
      if (!options.container.contains(item.element)) throw new Error("Roving item outside container");
      return registrations.add(() => {
        map.set(item.id, item);
        if (!loadingInitial) sync();
        return () => {
          if (map.get(item.id) === item) {
            map.delete(item.id);
            item.element.removeAttribute("tabindex");
            // Teardown disposes all registrations synchronously. Re-sorting
            // survivors after every removal is unnecessary and quadratic.
            if (!closed) sync();
          }
        };
      });
    },
    move(id, focus = true, detail = { reason: "programmatic" }) {
      if (closed) return;
      const item = available().find(x => x.id === id);
      if (!item) return;
      if (selected !== id) {
        selected = id;
        sync();
        options.onActiveChange?.(id, detail);
      }
      if (focus) item.element.focus();
    },
    dispose() { cleanup.dispose(); }
  };
  const onKey = (event: Event) => {
    if (!(event instanceof KeyboardEvent) || event.altKey || event.metaKey || event.ctrlKey) return;
    const items = available();
    if (!items.length) return;
    const current = items.findIndex(x => x.element === event.target);
    if (current < 0) return; // Ignore keyboard input outside registered active items.
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
    const wrap = options.loop ?? options.wrap ?? true;
    let index = shift === Infinity ? items.length - 1 : shift === -Infinity ? 0 : current + shift;
    if (wrap) index = ((index % items.length) + items.length) % items.length;
    else index = Math.max(0, Math.min(items.length - 1, index));
    controller.move(items[index]!.id, true, { reason: "keyboard", originalEvent: event });
  };
  for (const element of options.items?.() ?? []) {
    if (!element.id) throw new Error("Roving items() entries need stable DOM IDs");
    controller.register({ id: element.id, element });
  }
  loadingInitial = false;
  if (map.size) sync();
  const listener = listen(options.container, "keydown", onKey, options.owner);
  const cleanup = own(() => {
    if (closed) return;
    closed = true;
    listener.dispose();
    registrations.dispose();
    for (const item of map.values()) item.element.removeAttribute("tabindex");
    map.clear();
    selected = null;
  }, options.owner);
  return controller;
}
