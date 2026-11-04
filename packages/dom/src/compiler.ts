/** M0 COMPILER ABI TYPES ONLY. No callable runtime helpers are exported. */
import type { BindingHandle, Namespace } from "./index.js";
import type { OwnerScope } from "@zaakiyjs/core";
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
