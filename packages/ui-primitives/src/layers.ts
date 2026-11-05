import { createContext, provide, useContext } from "@zaakiyjs/core";
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
  /** Validate the host/document before any controller changes DOM state. */
  accepts(element: HTMLElement): boolean;
  add(options: LayerOptions): PrimitiveHandle;
  top(): HTMLElement | null;
  containsTop(node: Node): boolean;
  /** Active layers above this element, for logical focus containment of portalled controls. */
  above(element: HTMLElement): readonly HTMLElement[];
}
export interface OverlayManagerOptions {
  readonly root: HTMLElement;
  readonly host: HTMLElement;
  readonly owner: OwnerScope;
  /** Document-wide outside events opt out of isolated application-root dismissal. */
  readonly outsideBoundary?: "application" | "document";
  /** Default true. Disables native document-element scroll while a modal is active. */
  readonly lockScroll?: boolean;
}

const managerContext = createContext<OverlayManager>("ZaakiyJS application overlay manager");
export function getOverlayManager(owner: OwnerScope): OverlayManager | undefined {
  return useContext(owner, managerContext);
}

// These WeakMaps coordinate only shared DOM resources, never component or app state.
// Per-document/per-element weak keys cannot leak state into another document/SSR root.
const inertResources = new WeakMap<Element, { count: number; originallyInert: boolean }>();
const scrollResources = new WeakMap<Document, {
  count: number; overflow: string; priority: string;
}>();
function acquireInert(node: Element): void {
  const resource = inertResources.get(node);
  if (resource) resource.count++;
  else inertResources.set(node, { count: 1, originallyInert: node.hasAttribute("inert") });
  node.setAttribute("inert", "");
}
function releaseInert(node: Element): void {
  const resource = inertResources.get(node);
  if (!resource) return;
  if (--resource.count > 0) return;
  inertResources.delete(node);
  if (!resource.originallyInert) node.removeAttribute("inert");
  else node.setAttribute("inert", "");
}
function acquireScroll(doc: Document): void {
  const existing = scrollResources.get(doc);
  if (existing) { existing.count++; return; }
  const root = doc.documentElement;
  if (!root) return;
  scrollResources.set(doc, {
    count: 1,
    overflow: root.style.getPropertyValue("overflow"),
    priority: root.style.getPropertyPriority("overflow")
  });
  root.style.setProperty("overflow", "hidden");
}
function releaseScroll(doc: Document): void {
  const existing = scrollResources.get(doc);
  if (!existing || --existing.count > 0) return;
  scrollResources.delete(doc);
  const root = doc.documentElement;
  if (!root) return;
  if (existing.overflow) root.style.setProperty("overflow", existing.overflow, existing.priority);
  else root.style.removeProperty("overflow");
}

/** Owns one stack per application, while safely sharing only browser inert/scroll locks. */
export function createOverlayManager(options: OverlayManagerOptions): OverlayManager {
  const { root, host, owner } = options;
  if (!owner || owner.disposed) throw new Error("Overlay manager needs a live Core owner");
  if (root.ownerDocument !== host.ownerDocument) throw new Error("Overlay root and host must share a document");
  const doc = host.ownerDocument;
  const focusManager = createFocusManager(owner);
  type Entry = LayerOptions & { readonly id: number };
  const layers: Entry[] = [];
  const handles = new Map<Entry, PrimitiveHandle>();
  const registrations = createRegistrationGroup(owner);
  const inertHeld = new Set<Element>();
  let scrollHeld = false;
  let sequence = 0;
  let disposed = false;
  let hostWasConnected = host.isConnected;
  const restoreResources = () => {
    for (const node of inertHeld) releaseInert(node);
    inertHeld.clear();
    if (scrollHeld) { releaseScroll(doc); scrollHeld = false; }
  };
  const syncResources = () => {
    const modal = [...layers].reverse().find(layer => layer.modal && layer.element.isConnected);
    const desired = new Set<Element>();
    if (modal) {
      // Sibling-portalled menus/popovers above the modal stay operable, while
      // background and lower layers remain inert. Mark only nodes outside the
      // union of all protected ancestor paths.
      const index = layers.indexOf(modal);
      const paths = [modal, ...layers.slice(index + 1)]
        .filter(layer => layer.element.isConnected);
      const protectedNodes = new Set<Element>();
      for (const layer of paths) {
        for (let node: Element | null = layer.element; node; node = node.parentElement) {
          protectedNodes.add(node);
          if (node === doc.body) break;
        }
      }
      for (const node of protectedNodes) {
        if (node === doc.body || !node.parentElement) continue;
        for (const sibling of node.parentElement.children) {
          if (!protectedNodes.has(sibling)) desired.add(sibling);
        }
      }
    }
    for (const node of [...inertHeld]) {
      if (desired.has(node)) continue;
      releaseInert(node); inertHeld.delete(node);
    }
    for (const node of desired) {
      if (inertHeld.has(node)) continue;
      acquireInert(node); inertHeld.add(node);
    }
    if (options.lockScroll !== false && modal && !scrollHeld) {
      acquireScroll(doc); scrollHeld = true;
    } else if (!modal && scrollHeld) {
      releaseScroll(doc); scrollHeld = false;
    }
  };
  const top = () => layers.at(-1) ?? null;
  const withinBoundary = (target: EventTarget | null): target is Node =>
    target instanceof Node && ((options.outsideBoundary === "document" && doc.contains(target)) ||
      root.contains(target) || host.contains(target));
  const keydown = listen(doc, "keydown", (event: Event) => {
    if (!(event instanceof KeyboardEvent) || event.key !== "Escape" || event.isComposing) return;
    const active = top();
    if (!active?.dismissOnEscape || !active.onDismiss || !withinBoundary(event.target)) return;
    active.onEscapeKeyDown?.(event);
    if (event.defaultPrevented) return;
    event.preventDefault();
    event.stopPropagation();
    active.onDismiss({ reason: "escape", originalEvent: event });
  }, owner, { capture: true });
  const pointer = listen(doc, "pointerdown", (event: Event) => {
    const active = top();
    if (!active?.dismissOnOutsidePointer || !active.onDismiss || !withinBoundary(event.target)) return;
    const path = event.composedPath();
    if (path.includes(active.element) || (active.trigger && path.includes(active.trigger))) return;
    active.onPointerDownOutside?.(event as PointerEvent);
    if (!event.defaultPrevented) active.onDismiss({ reason: "outside-pointer", originalEvent: event });
  }, owner, { capture: true });
  const observer = doc.defaultView?.MutationObserver
    ? new doc.defaultView.MutationObserver(() => {
      if (disposed) return;
      if (host.isConnected) hostWasConnected = true;
      else if (hostWasConnected) {
        lifecycle.dispose();
        return;
      }
      for (const entry of [...layers]) {
        if (!host.contains(entry.element)) handles.get(entry)?.dispose();
      }
      // The host may have been inserted after an application initialized.
      if (layers.length && host.isConnected && !inertHeld.size) syncResources();
    }) : null;
  observer?.observe(doc, { childList: true, subtree: true });
  const lifecycle = own(() => {
    if (disposed) return;
    disposed = true;
    observer?.disconnect();
    registrations.dispose();
    layers.length = 0;
    handles.clear();
    restoreResources();
    keydown.dispose();
    pointer.dispose();
  }, owner);
  const manager: OverlayManager = {
    focusManager,
    dispose: () => lifecycle.dispose(),
    accepts(element) { return !disposed && !owner.disposed &&
      element.ownerDocument === doc && host.contains(element); },
    top: () => top()?.element ?? null,
    containsTop: (node: Node) => !!top()?.element.contains(node),
    above(element) {
      const index = layers.findIndex(layer => layer.element === element);
      return index < 0 ? [] : layers.slice(index + 1)
        .filter(layer => layer.element.isConnected).map(layer => layer.element);
    },
    add(layerOptions) {
      if (disposed || owner.disposed) throw new Error("Overlay manager is disposed");
      if (layerOptions.element.ownerDocument !== doc || !host.contains(layerOptions.element)) {
        throw new Error("Overlay element must be inside the explicit application host");
      }
      const entry: Entry = { ...layerOptions, id: ++sequence };
      const handle = registrations.add(() => {
        layers.push(entry);
        entry.element.dataset.zaakiyLayer = String(entry.id);
        syncResources();
        return () => {
          const position = layers.indexOf(entry);
          if (position < 0) return;
          layers.splice(position, 1);
          handles.delete(entry);
          delete entry.element.dataset.zaakiyLayer;
          syncResources();
        };
      });
      handles.set(entry, handle);
      return handle;
    }
  };
  try {
    provide(owner, managerContext, manager);
  } catch (error) {
    lifecycle.dispose();
    throw error;
  }
  return manager;
}
