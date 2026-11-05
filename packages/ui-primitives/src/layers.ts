import type { OwnerScope } from "@zaakiyjs/core";
import { listen, own, createRegistrationGroup } from "./lifecycle.js";
import type { PrimitiveHandle } from "./lifecycle.js";
import { createFocusManager } from "./focus.js";
import type { FocusManager } from "./focus.js";

export type DismissReason = "escape" | "outside-pointer";
export interface DismissEvent {
  readonly reason: DismissReason;
  readonly originalEvent: Event;
}
export interface LayerOptions {
  readonly element: HTMLElement;
  readonly trigger?: HTMLElement;
  readonly onEscapeKeyDown?: (event: KeyboardEvent) => void;
  readonly onPointerDownOutside?: (event: PointerEvent) => void;
  readonly modal?: boolean;
  readonly dismissOnEscape?: boolean;
  readonly dismissOnOutsidePointer?: boolean;
  readonly onDismiss?: (event: DismissEvent) => void;
}
export interface OverlayManager extends PrimitiveHandle {
  readonly focusManager: FocusManager;
  add(options: LayerOptions): PrimitiveHandle;
  top(): HTMLElement | null;
  containsTop(node: Node): boolean;
}
export interface OverlayManagerOptions {
  readonly root: HTMLElement;
  readonly host: HTMLElement;
  readonly owner: OwnerScope;
}
/** Explicit per-application overlay stack, without a shared global registry. */
export function createOverlayManager({ root, host, owner }: OverlayManagerOptions): OverlayManager {
  if (root.ownerDocument !== host.ownerDocument) throw new Error("Overlay root and host must share a document");
  if (!owner || owner.disposed) throw new Error("Overlay manager needs a live Core owner");
  const doc = host.ownerDocument;
  const focusManager = createFocusManager(owner);
  type Entry = LayerOptions & { readonly id: number };
  const layers: Entry[] = [];
  const registrations = createRegistrationGroup(owner);
  let sequence = 0;
  let disposed = false;
  const originalInert = new Map<Element, boolean>();
  const restoreInert = () => {
    for (const [node, initial] of originalInert) {
      if (initial) node.setAttribute("inert", "");
      else node.removeAttribute("inert");
    }
    originalInert.clear();
  };
  const inertOutside = (target: HTMLElement) => {
    for (let cursor: Element | null = target; cursor?.parentElement; cursor = cursor.parentElement) {
      for (const sibling of Array.from(cursor.parentElement.children)) {
        if (sibling === cursor) continue;
        if (!originalInert.has(sibling)) originalInert.set(sibling, sibling.hasAttribute("inert"));
        sibling.setAttribute("inert", "");
      }
      if (cursor.parentElement === doc.body) break;
    }
  };
  const syncInert = () => {
    restoreInert();
    const modal = [...layers].reverse().find(layer => layer.modal);
    if (modal && modal.element.isConnected) inertOutside(modal.element);
  };
  const top = () => layers.at(-1) ?? null;
  // A removed portal host must never leave a permanently inert document.
  const observer = doc.defaultView?.MutationObserver
    ? new doc.defaultView.MutationObserver(() => {
      if (!disposed && !host.isConnected) {
        registrations.dispose();
        layers.length = 0;
        restoreInert();
      }
    }) : null;
  observer?.observe(doc, { childList: true, subtree: true });
  const withinApp = (target: EventTarget | null): target is Node =>
    target instanceof Node && (root.contains(target) || host.contains(target));
  const keydown = listen(doc, "keydown", (event: Event) => {
    if (!(event instanceof KeyboardEvent) || event.key !== "Escape" || event.isComposing) return;
    const active = top();
    if (!active?.dismissOnEscape || !withinApp(event.target)) return;
    active.onEscapeKeyDown?.(event);
    if (event.defaultPrevented) return;
    event.preventDefault();
    event.stopPropagation();
    active.onDismiss?.({ reason: "escape", originalEvent: event });
  }, owner, { capture: true });
  const pointer = listen(doc, "pointerdown", (event: Event) => {
    const active = top();
    if (!active?.dismissOnOutsidePointer || !withinApp(event.target)) return;
    const path = event.composedPath();
    if (path.includes(active.element) || (active.trigger && path.includes(active.trigger))) return;
    active.onPointerDownOutside?.(event as PointerEvent);
    if (event.defaultPrevented) return;
    active.onDismiss?.({ reason: "outside-pointer", originalEvent: event });
  }, owner, { capture: true });
  const lifecycle = own(() => {
    if (disposed) return;
    disposed = true;
    registrations.dispose();
    layers.length = 0;
    observer?.disconnect();
    restoreInert();
    keydown.dispose();
    pointer.dispose();
  }, owner);
  return {
    dispose: () => lifecycle.dispose(),
    focusManager,
    top: () => top()?.element ?? null,
    containsTop: (node: Node) => !!top()?.element.contains(node),
    add(options) {
      if (disposed || owner.disposed) throw new Error("Overlay manager is disposed");
      if (options.element.ownerDocument !== doc || !host.contains(options.element)) {
        throw new Error("Overlay element must be inside the explicit application host");
      }
      const entry: Entry = { ...options, id: ++sequence };
      return registrations.add(() => {
        layers.push(entry);
        options.element.dataset.zaakiyLayer = String(entry.id);
        syncInert();
        return () => {
          const index = layers.indexOf(entry);
          if (index < 0) return;
          layers.splice(index, 1);
          delete options.element.dataset.zaakiyLayer;
          syncInert();
        };
      });
    }
  };
}
