import { getOwner } from "@zaakiyjs/core";
import type { OwnerScope, ViewNode } from "@zaakiyjs/core";
import { createElement } from "@zaakiyjs/dom/compiler";

/** Native DOM ABI bridge: nodes are never virtual/JSX objects. */
export function native(tag: string): HTMLElement {
  return createElement(tag, "html") as HTMLElement;
}
export function currentOwner(): OwnerScope {
  const owner = getOwner();
  if (!owner || owner.disposed) throw new Error("@zaakiyjs/ui requires a live owner");
  return owner;
}
export function view(node: Node): ViewNode { return node as unknown as ViewNode; }
export function nonEmpty(value: string, name: string): string {
  if (!value.trim()) throw new TypeError(name+" must not be empty");
  return value;
}
export function safeHref(url:string):string {
  if (!url || [...url].some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)) throw new TypeError("Invalid URL");
  const value=url.trim();
  if (!value || value.startsWith("//")) throw new TypeError("Unsafe URL");
  const match=/^([a-z][\w+.-]*):/iu.exec(value);
  if (match && !["http","https","mailto","tel"].includes(match[1]!.toLowerCase()))
    throw new TypeError("Unsupported URL scheme");
  return value;
}
