import type { OwnerScope } from "@zaakiyjs/core";
import { own } from "./lifecycle.js";
import type { PrimitiveHandle } from "./lifecycle.js";

export interface PortalOptions {
  /** An explicit host, ideally owned by the same application root. */
  readonly host: HTMLElement;
  /** Only detached nodes may enter a portal: never steal a compiler-owned range. */
  readonly nodes: readonly Node[];
  readonly owner: OwnerScope;
  readonly contentOwner?: OwnerScope;
}
function rootOf(owner: OwnerScope): OwnerScope {
  let root = owner;
  while (root.parent) root = root.parent;
  return root;
}
export function createPortal(options: PortalOptions): PrimitiveHandle {
  const { host, owner, nodes } = options;
  if (owner.disposed || (options.contentOwner && options.contentOwner.disposed)) throw new Error("Disposed portal owner");
  if (options.contentOwner && rootOf(options.contentOwner) !== rootOf(owner)) {
    throw new Error("Cannot portal nodes across application roots");
  }
  if (new Set(nodes).size !== nodes.length || nodes.some(node =>
    node.parentNode !== null || node.ownerDocument !== host.ownerDocument ||
    node === host || node.contains(host))) throw new Error("Portal requires distinct detached nodes in the host document");
  for (const node of nodes) host.appendChild(node);
  try {
    return own(() => { for (const node of nodes) node.parentNode?.removeChild(node); }, owner);
  } catch (error) {
    for (const node of nodes) node.parentNode?.removeChild(node);
    throw error;
  }
}
