import { createOwner, disposeOwner, initializeOwnedComponent, mountOwner } from "@zaakiyjs/core";
import type { OwnerScope } from "@zaakiyjs/core";

export const foundationStatus = { package: "@zaakiyjs/dom", implemented: true } as const;

export interface BindingHandle {
  dispose(): void;
}

export interface MountHandle {
  readonly owner: OwnerScope;
  /** The opening comment of this mounted DOM range, including multi-root views. */
  readonly root: Node;
  dispose(): void;
}

export type DomTarget = Element | DocumentFragment;
export type Namespace = "html" | "svg" | "mathml";
export type MountResult = Node | DocumentFragment | readonly Node[];
/** A compiler-lowered factory, not a JSX runtime or a component rerender function. */
export type MountFactory = (owner: OwnerScope) => MountResult;

/** Reserved M0 shapes; a public keyed-loop ABI awaits a coordinated ADR. */
export interface KeyedEntry<Key, Item> {
  readonly key: Key;
  readonly item: Item;
  readonly node: Node;
}
export interface KeyedLoopOptions<Key, Item> {
  readonly keyOf: (item: Item) => Key;
  readonly create: (item: Item) => Node;
}

/**
 * Execute a compiled factory once in a fresh application owner.
 * The range markers allow safe unmounting of multiple roots without disturbing
 * unrelated nodes already in the container.
 */
export function mount(factory: MountFactory, container: DomTarget): MountHandle {
  const owner = createOwner();
  const doc = container.ownerDocument ?? document;
  const start = doc.createComment("zaakiy-root:start");
  const end = doc.createComment("zaakiy-root:end");
  container.appendChild(start);
  container.appendChild(end);
  let disposed = false;

  const removeRange = (): void => {
    let node: Node | null = start;
    while (node) {
      const next: Node | null = node.nextSibling;
      node.parentNode?.removeChild(node);
      if (node === end) break;
      node = next;
    }
  };

  try {
    const view = initializeOwnedComponent(owner, () => factory(owner));
    const nodes: readonly Node[] = Array.isArray(view)
      ? view as readonly Node[]
      : [view as Node];
    // Validate the complete root list before inserting any of it.
    const unique = new Set<Node>();
    for (const node of nodes) {
      if (!node || typeof node.nodeType !== "number" || unique.has(node)) {
        throw new TypeError("Compiled mount factory must return distinct native DOM nodes");
      }
      unique.add(node);
    }
    for (const node of nodes) container.insertBefore(node, end);
    mountOwner(owner);
  } catch (error) {
    let cleanupError: unknown;
    try { disposeOwner(owner); }
    catch (caught) { cleanupError = caught; }
    finally { removeRange(); }
    if (cleanupError !== undefined) {
      throw new AggregateError([error, cleanupError], "DOM mount and cleanup failed");
    }
    throw error;
  }

  return {
    owner,
    root: start,
    dispose(): void {
      if (disposed) return;
      disposed = true;
      try {
        disposeOwner(owner);
      } finally {
        removeRange();
      }
    }
  };
}
