/**
 * Internal implementation of conditional and keyed DOM regions.
 * Not exported via package exports: the public compiler loop ABI is pending ADR.
 */
import { createOwner, disposeOwner, initializeOwnedComponent, mountOwner, onCleanup, onMount, runWithOwner } from "@zaakiyjs/core";
import type { OwnerScope } from "@zaakiyjs/core";
import { effect, untrack } from "@zaakiyjs/signals";
import type { BindingHandle } from "./index.js";

export interface DomRegion {
  readonly parent: Node;
  readonly start: Comment;
  readonly end: Comment;
}

export function createRegion(parent: Node, before: Node | null = null): DomRegion {
  const doc = parent.ownerDocument ?? (parent as Document);
  const start = doc.createComment("zaakiy-region:start");
  const end = doc.createComment("zaakiy-region:end");
  parent.insertBefore(start, before);
  parent.insertBefore(end, before);
  return { parent, start, end };
}

function removeBetween(start: Node, end: Node): void {
  let current = start.nextSibling;
  while (current && current !== end) {
    const next = current.nextSibling;
    current.parentNode?.removeChild(current);
    current = next;
  }
}

/** Mount child owners only after the containing root becomes mounted. */
function mountChild(parent: OwnerScope, child: OwnerScope): void {
  if (parent.state === "created" || parent.state === "initialized") {
    runWithOwner(parent, () => onMount(() => {
      if (!child.disposed) mountOwner(child);
    }));
  } else {
    mountOwner(child);
  }
}

function ownEffect(owner: OwnerScope, run: () => void, teardown: () => void): BindingHandle {
  if (owner.disposed) throw new Error("Cannot create a region in a disposed owner");
  return runWithOwner(owner, () => {
    let active: ReturnType<typeof effect> | undefined;
    let closed = false;
    const handle: BindingHandle = {
      dispose(): void {
        if (closed) return;
        closed = true;
        const errors: unknown[] = [];
        try { active?.dispose(); } catch (error) { errors.push(error); }
        try { teardown(); } catch (error) { errors.push(error); }
        if (errors.length === 1) throw errors[0];
        if (errors.length > 1) throw new AggregateError(errors, "DOM region disposal failed");
      }
    };
    try {
      active = effect(run, { phase: "render" });
      onCleanup(() => handle.dispose());
    } catch (error) {
      try { handle.dispose(); }
      catch (cleanupError) {
        throw new AggregateError([error, cleanupError], "DOM region initialization failed");
      }
      throw error;
    }
    return handle;
  });
}

export function bindConditionalRegion(
  owner: OwnerScope,
  region: DomRegion,
  when: () => boolean,
  create: (child: OwnerScope) => Node,
  createOtherwise?: (child: OwnerScope) => Node
): BindingHandle {
  let current: OwnerScope | null = null;
  let currentBranch: boolean | null = null;
  const clear = (): void => {
    if (current) {
      const outgoing = current;
      current = null;
      currentBranch = null;
      try {
        disposeOwner(outgoing);
      } finally {
        removeBetween(region.start, region.end);
      }
      return;
    }
    removeBetween(region.start, region.end);
  };
  return ownEffect(owner, () => {
    const active = Boolean(when());
    if (current !== null && currentBranch === active) return;
    clear();
    const factory = active ? create : createOtherwise;
    if (!factory) return; // false branch without an explicit else is empty
    const child = createOwner(owner);
    try {
      // Child component setup must not subscribe the conditional predicate.
      const node = untrack(() => initializeOwnedComponent(child, () => factory(child)));
      region.parent.insertBefore(node, region.end);
      current = child;
      currentBranch = active;
      mountChild(owner, child);
    } catch (error) {
      current = null;
      currentBranch = null;
      let cleanupError: unknown;
      try { disposeOwner(child); } catch (caught) { cleanupError = caught; }
      removeBetween(region.start, region.end);
      if (cleanupError !== undefined) {
        throw new AggregateError([error, cleanupError], "Conditional mount and disposal failed");
      }
      throw error;
    }
  }, clear);
}

export interface KeyedView<Item> {
  readonly node: Node;
  /** Called when the value for an existing key changes; must not reinitialize the component. */
  readonly update?: (item: Item) => void;
}

interface RecordEntry<Key, Item> {
  readonly key: Key;
  readonly owner: OwnerScope;
  readonly start: Comment;
  readonly end: Comment;
  readonly view: KeyedView<Item>;
  item: Item;
}

function removeEntry<Key, Item>(entry: RecordEntry<Key, Item>): void {
  try {
    disposeOwner(entry.owner);
  } finally {
    let cursor: Node | null = entry.start;
    while (cursor) {
      const next: Node | null = cursor.nextSibling;
      cursor.parentNode?.removeChild(cursor);
      if (cursor === entry.end) break;
      cursor = next;
    }
  }
}

function moveRange(parent: Node, start: Node, end: Node, before: Node): void {
  if (end.nextSibling === before) return;
  const doc = parent.ownerDocument ?? (parent as Document);
  const fragment = doc.createDocumentFragment();
  let cursor: Node | null = start;
  while (cursor) {
    const next: Node | null = cursor.nextSibling;
    fragment.appendChild(cursor);
    if (cursor === end) break;
    cursor = next;
  }
  parent.insertBefore(fragment, before);
}

interface FocusSnapshot {
  readonly element: HTMLElement | SVGElement;
  readonly start: number | null;
  readonly end: number | null;
  readonly direction: "forward" | "backward" | "none" | null;
}

function captureFocus(parent: Node): FocusSnapshot | null {
  const doc = parent.ownerDocument ?? (parent as Document);
  const element = doc.activeElement;
  if (!element || !parent.contains(element)) return null;
  const focusable = element as HTMLElement | SVGElement;
  if (typeof focusable.focus !== "function") return null;
  const input = element as HTMLInputElement;
  try {
    return {
      element: focusable,
      start: typeof input.selectionStart === "number" ? input.selectionStart : null,
      end: typeof input.selectionEnd === "number" ? input.selectionEnd : null,
      direction: input.selectionDirection ?? null
    };
  } catch {
    return { element: focusable, start: null, end: null, direction: null };
  }
}

function restoreFocus(snapshot: FocusSnapshot | null): void {
  if (!snapshot || !snapshot.element.isConnected) return;
  const doc = snapshot.element.ownerDocument;
  if (doc.activeElement !== snapshot.element) {
    snapshot.element.focus({ preventScroll: true });
  }
  const input = snapshot.element as HTMLInputElement;
  if (snapshot.start !== null && snapshot.end !== null &&
      typeof input.setSelectionRange === "function") {
    try {
      input.setSelectionRange(snapshot.start, snapshot.end, snapshot.direction ?? undefined);
    } catch {
      // Non-text input types do not support selections.
    }
  }
}

/**
 * Updates keyed DOM ranges without component rerendering.
 * Validates every key before modifying the existing tree.
 */
export function bindKeyedRegion<Key extends PropertyKey, Item>(
  owner: OwnerScope,
  region: DomRegion,
  read: () => readonly Item[],
  keyOf: (item: Item) => Key,
  create: (item: Item, child: OwnerScope) => KeyedView<Item>
): BindingHandle {
  const records = new Map<Key, RecordEntry<Key, Item>>();
  const clear = (): void => {
    const errors: unknown[] = [];
    for (const record of records.values()) {
      try {
        removeEntry(record);
      } catch (error) {
        errors.push(error);
      }
    }
    records.clear();
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) throw new AggregateError(errors, "Keyed region teardown failed");
  };
  return ownEffect(owner, () => {
    const items = read();
    const next = new Map<Key, Item>();
    for (const item of items) {
      const key = untrack(() => keyOf(item));
      if (typeof key !== "string" && typeof key !== "number" && typeof key !== "symbol") {
        throw new TypeError("Keyed region requires a stable string, number or symbol key");
      }
      if (next.has(key)) throw new Error("Duplicate key in ZaakiyJS keyed region: " + String(key));
      next.set(key, item);
    }

    // A stable key must not silently retain stale DOM when the object behind
    // that key is replaced. Validate before mutating the existing region.
    for (const [key, item] of next) {
      const previous = records.get(key);
      if (previous && !Object.is(previous.item, item) && !previous.view.update) {
        throw new Error("Changed keyed item requires a view.update handler for key: " + String(key));
      }
    }

    const focused = captureFocus(region.parent);
    try {
      // Stage additions before removals. A failing factory cannot drop existing
      // keyed DOM; newly created owners are rolled back on failure.
      const ordered: RecordEntry<Key, Item>[] = [];
      const added: RecordEntry<Key, Item>[] = [];
      try {
        for (const [key, item] of next) {
          let record = records.get(key);
          if (!record) {
            const child = createOwner(owner);
            let view: KeyedView<Item>;
            try {
              view = untrack(() => initializeOwnedComponent(child, () => create(item, child)));
            } catch (error) {
              try { disposeOwner(child); } catch { /* original error takes precedence */ }
              throw error;
            }
            const doc = region.parent.ownerDocument ?? (region.parent as Document);
            const start = doc.createComment("zaakiy-item:start");
            const end = doc.createComment("zaakiy-item:end");
            const fragment = doc.createDocumentFragment();
            fragment.appendChild(start);
            fragment.appendChild(view.node);
            fragment.appendChild(end);
            record = { key, item, owner: child, start, end, view };
            try {
              region.parent.insertBefore(fragment, region.end);
              records.set(key, record);
              added.push(record);
              mountChild(owner, child);
            } catch (error) {
              if (!added.includes(record)) {
                try { removeEntry(record); } catch { /* original error takes precedence */ }
              }
              throw error;
            }
          } else if (!Object.is(record.item, item)) {
            // Item-level binding reads must not invalidate the entire keyed loop.
            untrack(() => record?.view.update?.(item));
            record.item = item;
          }
          ordered.push(record);
        }
      } catch (error) {
        const rollbackErrors: unknown[] = [];
        for (const record of added) {
          records.delete(record.key);
          try { removeEntry(record); }
          catch (cleanupError) { rollbackErrors.push(cleanupError); }
        }
        if (rollbackErrors.length) {
          throw new AggregateError([error, ...rollbackErrors], "Keyed region update and rollback failed");
        }
        throw error;
      }

      for (const [key, record] of records) {
        if (!next.has(key)) {
          records.delete(key);
          removeEntry(record);
        }
      }

      // Right-to-left placement minimizes moves when suffixes are already stable.
      let before: Node = region.end;
      for (let i = ordered.length - 1; i >= 0; i--) {
        const record = ordered[i];
        if (!record) continue;
        moveRange(region.parent, record.start, record.end, before);
        before = record.start;
      }
    } finally {
      restoreFocus(focused);
    }
  }, clear);
}
