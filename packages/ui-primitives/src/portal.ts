import type { OwnerScope } from "@zaakiyjs/core";
import { own } from "./lifecycle.js";
import type { PrimitiveHandle } from "./lifecycle.js";

export interface PortalOptions {
  /** An explicit host supplied by the owning application. Never inferred from document.body. */
  readonly host: Element | DocumentFragment;
  readonly nodes: readonly Node[];
  readonly owner: OwnerScope;
  /** Optional proof that separately constructed nodes have the same owner root. */
  readonly contentOwner?: OwnerScope;
}
export interface PortalHandle extends PrimitiveHandle {
  readonly owner: OwnerScope;
  readonly host: Element | DocumentFragment;
  readonly nodes: readonly Node[];
}
function rootOf(owner: OwnerScope): OwnerScope {
  let root = owner;
  while (root.parent) root = root.parent;
  return root;
}
export function createPortal(options: PortalOptions): PortalHandle {
  const { host, owner, nodes } = options;
  if (!owner || owner.disposed || options.contentOwner?.disposed) throw new Error("Disposed portal owner");
  if (options.contentOwner && rootOf(options.contentOwner) !== rootOf(owner)) {
    throw new Error("Cannot portal nodes across application roots");
  }
  if (new Set(nodes).size !== nodes.length || nodes.some(node =>
    node.parentNode !== null || node.ownerDocument !== host.ownerDocument ||
    node === host || node.contains(host))) {
    throw new Error("Portal requires distinct detached nodes in the host document");
  }
  // Preserve native node identity; never extract a compiler-owned DOM range.
  const appended: Node[] = [];
  try {
    for (const node of nodes) {
      host.appendChild(node);
      appended.push(node);
    }
  } catch (error) {
    for (const node of appended) if (node.parentNode === host) host.removeChild(node);
    throw error;
  }
  const doc = host.ownerDocument;
  let observer: MutationObserver | null = null;
  const remove = () => {
    observer?.disconnect();
    observer = null;
    for (const node of nodes) if (node.parentNode === host) host.removeChild(node);
  };
  try {
    // Host removal is a terminal teardown: never keep detached interactive overlays.
    if (host.nodeType === 1 && host.isConnected && doc.defaultView?.MutationObserver) {
      observer = new doc.defaultView.MutationObserver(() => {
        if (!host.isConnected) handle.dispose();
      });
      observer.observe(doc, { subtree: true, childList: true });
    }
    const lifetime = own(remove, owner);
    const handle: PortalHandle = {
      owner, host, nodes,
      dispose: () => lifetime.dispose()
    };
    return handle;
  } catch (error) {
    remove();
    throw error;
  }
}
