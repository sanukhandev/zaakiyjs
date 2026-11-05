import type { OwnerScope } from "@zaakiyjs/core";
import { listen, own } from "./lifecycle.js";
import type { PrimitiveHandle } from "./lifecycle.js";

export interface FocusScopeOptions {
  readonly container: HTMLElement;
  readonly owner: OwnerScope;
  readonly manager?: FocusManager;
  readonly trapFocus?: boolean;
  readonly contain?: boolean;
  readonly restoreFocus?: boolean;
  readonly initialFocus?: HTMLElement | (() => HTMLElement | null);
}

export interface FocusManager {
  isTop(scope: FocusScopeHandle): boolean;
  add(scope: FocusScopeHandle): void;
  remove(scope: FocusScopeHandle): void;
}
export interface FocusScopeHandle extends PrimitiveHandle {
  readonly owner: OwnerScope;
  readonly element: HTMLElement;
  readonly container: HTMLElement;
  focusInitial(): void;
}

/** Application-root stack, with no global mutable focus registry. */
export function createFocusManager(owner?: OwnerScope): FocusManager {
  const stack: FocusScopeHandle[] = [];
  own(() => { stack.length = 0; }, owner);
  return {
    isTop(scope) { return stack.at(-1) === scope; },
    add(scope) { if (!stack.includes(scope)) stack.push(scope); },
    remove(scope) {
      const index = stack.indexOf(scope);
      if (index >= 0) stack.splice(index, 1);
    }
  };
}

function hiddenOrInert(element: HTMLElement): boolean {
  for (let node: Element | null = element; node; node = node.parentElement) {
    if (node.hasAttribute("hidden") || node.hasAttribute("inert") ||
      node.getAttribute("aria-hidden") === "true") return true;
    const view: Window | null = node.ownerDocument.defaultView;
    const css: CSSStyleDeclaration | undefined = view?.getComputedStyle(node);
    if (css?.display === "none" || css?.visibility === "hidden" || css?.visibility === "collapse") return true;
  }
  return false;
}
export function isFocusable(element: HTMLElement, tabbable = false): boolean {
  if (!element.isConnected || hiddenOrInert(element) || element.matches(":disabled")) return false;
  const fieldset = element.closest("fieldset:disabled");
  if (fieldset) {
    const firstLegend = [...fieldset.children].find(child => child.tagName === "LEGEND");
    if (!firstLegend?.contains(element)) return false;
  }
  if (element instanceof HTMLInputElement && element.type === "hidden") return false;
  const tabIndex = element.getAttribute("tabindex");
  if (tabIndex !== null) {
    const number = Number(tabIndex);
    return Number.isInteger(number) && (!tabbable || number >= 0);
  }
  if (element instanceof HTMLAnchorElement || element instanceof HTMLAreaElement) return element.hasAttribute("href");
  if (element instanceof HTMLButtonElement || element instanceof HTMLSelectElement ||
      element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) return true;
  if (element.isContentEditable) return true;
  if (element instanceof HTMLAudioElement || element instanceof HTMLVideoElement) return element.hasAttribute("controls");
  if (element instanceof HTMLIFrameElement || element.tagName === "SUMMARY") return true;
  return false;
}
export function focusables(container: HTMLElement, tabbable = true): HTMLElement[] {
  const iterator = container.ownerDocument.createTreeWalker(container, NodeFilter.SHOW_ELEMENT);
  const result: HTMLElement[] = [];
  let node: Node | null;
  while ((node = iterator.nextNode())) {
    if (node instanceof HTMLElement && isFocusable(node, tabbable)) result.push(node);
  }
  // Positive tabindex precedes DOM-ordered elements with zero tabindex.
  return tabbable ? result.sort((a, b) => {
    const aIndex = a.tabIndex > 0 ? a.tabIndex : Infinity;
    const bIndex = b.tabIndex > 0 ? b.tabIndex : Infinity;
    return aIndex - bIndex;
  }) : result;
}

export function createFocusScope(options: FocusScopeOptions): FocusScopeHandle {
  const { container, owner, manager, restoreFocus = true } = options;
  if (!owner || owner.disposed) throw new Error("Focus scope needs a live Core owner");
  const contain = options.trapFocus ?? options.contain ?? false;
  const doc = container.ownerDocument;
  const previous = doc.activeElement instanceof HTMLElement ? doc.activeElement : null;
  let disposed = false;
  let entered = false;
  const isTop = () => !manager || manager.isTop(handle);
  const initial = () => typeof options.initialFocus === "function" ? options.initialFocus() : options.initialFocus;
  const focusInitial = () => {
    if (disposed || !container.isConnected || !isTop()) return;
    const requested = initial();
    const next = requested && container.contains(requested) && isFocusable(requested)
      ? requested : focusables(container)[0] ?? container;
    if (next === container && container.tabIndex < 0 && !container.hasAttribute("tabindex")) {
      container.setAttribute("tabindex", "-1");
      addedTabindex = true;
    }
    next.focus();
    entered = true;
  };
  let addedTabindex = false;
  const handle: FocusScopeHandle = { owner, element: container, container, focusInitial, dispose() { cleanup.dispose(); } };
  manager?.add(handle);

  const onKeyDown = (event: Event) => {
    if (!contain || !entered || !isTop() || !(event instanceof KeyboardEvent) || event.key !== "Tab") return;
    const items = focusables(container);
    const current = doc.activeElement;
    if (!items.length) {
      event.preventDefault();
      container.focus();
      return;
    }
    const first = items[0]!;
    const last = items.at(-1)!;
    if (!container.contains(current) || current === container) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
    } else if (event.shiftKey && current === first) {
      event.preventDefault(); last.focus();
    } else if (!event.shiftKey && current === last) {
      event.preventDefault(); first.focus();
    }
  };
  const onFocusIn = (event: Event) => {
    if (!contain || !entered || !isTop() || !container.isConnected) return;
    const target = event.target;
    if (!(target instanceof Node) || container.contains(target)) return;
    (focusables(container)[0] ?? container).focus();
  };
  const key = listen(doc, "keydown", onKeyDown, owner, { capture: true });
  const focus = listen(doc, "focusin", onFocusIn, owner);
  const cleanup = own(() => {
    if (disposed) return;
    disposed = true;
    key.dispose();
    focus.dispose();
    manager?.remove(handle);
    if (addedTabindex) container.removeAttribute("tabindex");
    if (restoreFocus && !owner.disposed && previous && isFocusable(previous)) previous.focus();
  }, owner);
  focusInitial();
  return handle;
}
