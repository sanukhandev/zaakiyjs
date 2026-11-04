/**
 * Browser-facing compiler DOM ABI v1. This module never imports AST, IR, Vite or
 * the compiler package. All dynamic writes are bound to the supplied owner.
 */
import { onCleanup, runWithOwner } from "@zaakiyjs/core";
import type { OwnerScope } from "@zaakiyjs/core";
import { effect } from "@zaakiyjs/signals";
import type { BindingHandle, Namespace } from "./index.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const MATH_NS = "http://www.w3.org/1998/Math/MathML";
const XLINK_NS = "http://www.w3.org/1999/xlink";
const ATTRIBUTE_NAME = /^[a-zA-Z_:][a-zA-Z0-9_:.-]*$/;
const CSS_NAME = /^(?:--[a-zA-Z0-9_-]+|-?[a-zA-Z][a-zA-Z0-9-]*)$/;
const URL_NAMES = new Set([
  "href", "src", "action", "formaction", "poster", "cite", "data",
  "xlink:href", "background", "longdesc", "manifest"
]);
const UNSAFE_PROPERTIES = new Set([
  "innerhtml", "outerhtml", "srcdoc", "insertadjacenthtml", "style",
  "__proto__", "prototype", "constructor"
]);

export interface CompilerDomAbiV1 {
  createElement(tag: string, namespace: Namespace): Element;
  createText(initial: string): Text;
  setText(target: Text, next: string): void;
  setProperty(target: Element, name: string, value: unknown): void;
  setAttribute(target: Element, name: string, value: string | null): void;
  bindText(owner: OwnerScope, node: Text, read: () => unknown): BindingHandle;
  bindProperty(owner: OwnerScope, node: Element, name: string, read: () => unknown): BindingHandle;
  listen(owner: OwnerScope, node: EventTarget, eventName: string, handler: EventListener, options?: AddEventListenerOptions): BindingHandle;
}

function assertWritableName(name: string): void {
  if (!ATTRIBUTE_NAME.test(name) || /^on/i.test(name)) {
    throw new TypeError("Unsafe DOM attribute or property name: " + name);
  }
}

function assertSafeUrl(value: unknown, name: string, base: string): void {
  const input = String(value);
  if (/[\u0000-\u001f\u007f]/.test(input)) {
    throw new TypeError("Control characters in URL binding: " + name);
  }
  const trimmed = input.trim();
  // srcset is a URL list; a scalar URL parser is not an adequate validator.
  if (name.toLowerCase() === "srcset") {
    throw new TypeError("srcset requires a separately approved URL-list policy");
  }
  let url: URL;
  try {
    url = new URL(trimmed, base);
  } catch {
    throw new TypeError("Malformed URL binding: " + name);
  }
  if (!["https:", "http:", "mailto:", "tel:"].includes(url.protocol)) {
    throw new TypeError("Blocked URL scheme in DOM binding: " + name);
  }
}

function validateValue(target: Element, name: string, value: unknown): void {
  if (value !== null && value !== undefined && URL_NAMES.has(name.toLowerCase())) {
    assertSafeUrl(value, name, target.ownerDocument.baseURI);
  }
}

export function createElement(tag: string, namespace: Namespace): Element {
  if (!/^[a-zA-Z][a-zA-Z0-9:._-]*$/.test(tag)) {
    throw new TypeError("Invalid element name: " + tag);
  }
  switch (namespace) {
    case "html": return document.createElement(tag);
    case "svg": return document.createElementNS(SVG_NS, tag);
    case "mathml": return document.createElementNS(MATH_NS, tag);
  }
}

export function createText(initial: string): Text {
  return document.createTextNode(initial);
}

export function setText(target: Text, next: string): void {
  if (target.data !== next) target.data = next;
}

export function setProperty(target: Element, name: string, value: unknown): void {
  assertWritableName(name);
  if (UNSAFE_PROPERTIES.has(name.toLowerCase()) || name.toLowerCase() === "srcset") {
    throw new TypeError("Unsafe or unsupported DOM property: " + name);
  }
  validateValue(target, name, value);
  // The equality guard preserves native focus, text selection and input state.
  const record = target as unknown as Record<string, unknown>;
  if (!Object.is(record[name], value)) record[name] = value;
}

export function setAttribute(target: Element, name: string, value: string | null): void {
  assertWritableName(name);
  if (["srcset", "srcdoc", "style"].includes(name.toLowerCase())) {
    throw new TypeError("srcset requires a separately approved URL-list policy");
  }
  validateValue(target, name, value);
  if (name === "xlink:href") {
    if (value === null) {
      if (target.hasAttributeNS(XLINK_NS, "href")) target.removeAttributeNS(XLINK_NS, "href");
    } else if (target.getAttributeNS(XLINK_NS, "href") !== value) {
      target.setAttributeNS(XLINK_NS, name, value);
    }
  } else if (value === null) {
    if (target.hasAttribute(name)) target.removeAttribute(name);
  } else if (target.getAttribute(name) !== value) {
    target.setAttribute(name, value);
  }
}

/** A class write uses the native class attribute for HTML and SVG. */
export function setClass(target: Element, value: string | null): void {
  setAttribute(target, "class", value);
}

/** Static or reactive CSS values: no executable CSS functions or arbitrary URLs. */
export function setStyle(target: Element, name: string, value: string | null): void {
  if (!CSS_NAME.test(name)) throw new TypeError("Invalid CSS property: " + name);
  if (value !== null && /(?:url\s*\(|expression\s*\(|@import|[{}])/i.test(value)) {
    throw new TypeError("Potentially unsafe CSS value: " + name);
  }
  const style = (target as HTMLElement | SVGElement).style;
  if (!style) throw new TypeError("Element does not expose inline style");
  if (value === null) {
    if (style.getPropertyValue(name)) style.removeProperty(name);
  } else if (style.getPropertyValue(name) !== value) {
    style.setProperty(name, value);
  }
}

/** Effects are registered with core ownership without a signals -> core cycle. */
function bind(owner: OwnerScope, run: () => void): BindingHandle {
  if (owner.disposed) throw new Error("Cannot bind to disposed owner");
  return runWithOwner(owner, () => {
    const active = effect(run, { phase: "render" });
    let closed = false;
    const handle: BindingHandle = {
      dispose(): void {
        if (closed) return;
        closed = true;
        active.dispose();
      }
    };
    onCleanup(() => handle.dispose());
    return handle;
  });
}

export function bindText(owner: OwnerScope, node: Text, read: () => unknown): BindingHandle {
  return bind(owner, () => setText(node, String(read() ?? "")));
}

export function bindProperty(
  owner: OwnerScope, node: Element, name: string, read: () => unknown
): BindingHandle {
  return bind(owner, () => setProperty(node, name, read()));
}

export function bindAttribute(
  owner: OwnerScope, node: Element, name: string, read: () => string | null
): BindingHandle {
  return bind(owner, () => setAttribute(node, name, read()));
}

export function bindClass(
  owner: OwnerScope, node: Element, read: () => string | null
): BindingHandle {
  return bind(owner, () => setClass(node, read()));
}

export function bindStyle(
  owner: OwnerScope, node: Element, name: string, read: () => string | null
): BindingHandle {
  return bind(owner, () => setStyle(node, name, read()));
}

/** Ref callbacks run exactly once per mount, with null on cleanup. */
export function bindRef<T extends Element>(
  owner: OwnerScope, node: T, ref: (value: T | null) => void
): BindingHandle {
  if (owner.disposed) throw new Error("Cannot reference a disposed owner");
  return runWithOwner(owner, () => {
    ref(node);
    let closed = false;
    const handle: BindingHandle = {
      dispose(): void {
        if (closed) return;
        closed = true;
        ref(null);
      }
    };
    onCleanup(() => handle.dispose());
    return handle;
  });
}

export function listen(
  owner: OwnerScope,
  node: EventTarget,
  eventName: string,
  handler: EventListener,
  options?: AddEventListenerOptions
): BindingHandle {
  if (owner.disposed) throw new Error("Cannot listen with a disposed owner");
  if (!/^[a-zA-Z][a-zA-Z0-9:_-]*$/.test(eventName)) {
    throw new TypeError("Invalid event name: " + eventName);
  }
  return runWithOwner(owner, () => {
    node.addEventListener(eventName, handler, options);
    let closed = false;
    const handle: BindingHandle = {
      dispose(): void {
        if (closed) return;
        closed = true;
        node.removeEventListener(eventName, handler, options);
      }
    };
    onCleanup(() => handle.dispose());
    return handle;
  });
}

/** A changing handler retains one native listener and its dispatch position. */
export function listenStable(
  owner: OwnerScope,
  node: EventTarget,
  name: string,
  read: () => EventListener,
  options?: AddEventListenerOptions
): BindingHandle {
  let current: EventListener = () => undefined;
  const wrapper: EventListener = (event) => current.call(node, event);
  const listener = listen(owner, node, name, wrapper, options);
  let binding: BindingHandle;
  try {
    binding = bind(owner, () => { current = read(); });
  } catch (error) {
    listener.dispose();
    throw error;
  }
  return {
    dispose(): void {
      binding.dispose();
      listener.dispose();
    }
  };
}

/** Clone only constructed DOM nodes; never parse a string with innerHTML. */
export function cloneStatic<T extends Node>(template: T): T {
  return template.cloneNode(true) as T;
}
