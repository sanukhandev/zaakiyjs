import { createOwner, disposeOwner, initializeOwnedComponent, mountOwner } from "@zaakiyjs/core";
import type { OwnerScope, ViewNode } from "@zaakiyjs/core";

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
/** TSX is typed as ViewNode pre-compilation; generated JS returns native nodes. */
export type MountFactory = (owner: OwnerScope) => MountResult | ViewNode;

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


/**
 * H2: attach an owner to already existing native DOM without replacing it.
 * A caller must validate the SSR build and DOM blueprint before invoking this.
 * This low-level API never parses HTML or executes source text.
 */
export interface HydrationMountHandle {
  readonly root: Node;
  readonly owner: OwnerScope;
  dispose(): void;
}
const activeHydrations = new WeakMap<Node, OwnerScope>();
export function hydrate<T extends Node>(
  root: T,
  attach: (owner: OwnerScope, existing: T) => void
): HydrationMountHandle {
  if (!root || typeof root.nodeType !== "number" || typeof attach !== "function")
    throw new TypeError("Native DOM hydration requires an existing node and an attachment factory");
  if (activeHydrations.has(root))
    throw new Error("Native DOM root already has a hydration owner");
  const owner = createOwner();
  activeHydrations.set(root, owner);
  let disposed = false;
  try {
    initializeOwnedComponent(owner, () => attach(owner, root));
    mountOwner(owner);
  } catch (error) {
    activeHydrations.delete(root);
    // initializeOwnedComponent already disposes after setup errors; mount errors
    // still need owner disposal. Preserve the original error if both fail.
    try { disposeOwner(owner); }
    catch (cleanupError) {
      throw new AggregateError([error, cleanupError], "Hydration setup and cleanup failed");
    }
    throw error;
  }
  return {
    root, owner,
    dispose(): void {
      if (disposed) return;
      disposed = true;
      try { disposeOwner(owner); }
      finally { activeHydrations.delete(root); }
    }
  };
}
