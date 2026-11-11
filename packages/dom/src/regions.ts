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


/**
 * Additive, opt-in presence extension for a single native Element.
 * The existing bindConditionalRegion continues to dispose immediately.
 * An exit callback retains a live owner and node until it resolves or times
 * out. Re-entry aborts the exit and reuses the same owner and element.
 * Not a compiler ABI v1 primitive and not a fragment/keyed exit protocol.
 */
export interface ExitAwareConditionalOptions {
  /** Hard upper bound for pending exit ownership (default 5000; max 30000ms). */
  readonly maxExitMs?: number;
  /** Optional nonthrowing diagnostic sink; an exit rejection still cleans up. */
  readonly onExitError?: (error: unknown) => void;
}

export function bindExitAwareConditionalRegion(
  owner: OwnerScope,
  region: DomRegion,
  when: () => boolean,
  create: (child: OwnerScope) => Element,
  exit: (node: Element, signal: AbortSignal) => void | Promise<void>,
  options: ExitAwareConditionalOptions = {}
): BindingHandle {
  const maxExitMs = options.maxExitMs ?? 5000;
  if (!Number.isSafeInteger(maxExitMs) || maxExitMs < 1 || maxExitMs > 30_000 ||
      typeof exit !== "function") {
    throw new TypeError("Exit-aware region requires a bounded duration and exit callback");
  }
  let current: { owner: OwnerScope; node: Element } | null = null;
  let pending: { revision: number; controller: AbortController; timer: ReturnType<typeof setTimeout> } | null = null;
  let revision = 0;

  const stopExit = (): void => {
    const previous = pending;
    pending = null;
    if (!previous) return;
    clearTimeout(previous.timer);
    previous.controller.abort(new Error("Presence exit superseded or owner disposed"));
  };
  const clear = (): void => {
    stopExit();
    const previous = current;
    current = null;
    if (previous) {
      try { disposeOwner(previous.owner); }
      finally { removeBetween(region.start, region.end); }
    } else removeBetween(region.start, region.end);
  };
  const failed = (error: unknown): void => {
    // Telemetry cannot prevent deterministic cleanup or create unhandled
    // Promise rejections while a presence exit is unwinding.
    try { options.onExitError?.(error); } catch { /* diagnostic hook is isolated */ }
  };
  const settle = (ticket: number, timedOut = false): void => {
    if (!pending || pending.revision !== ticket) return;
    const active = pending;
    pending = null;
    clearTimeout(active.timer);
    if (timedOut) active.controller.abort(new Error("Presence exit timeout"));
    clear();
  };

  return ownEffect(owner, () => {
    if (when()) {
      stopExit();
      if (current) return; // Same connected native node and scoped owner.
      const child = createOwner(owner);
      try {
        const node = untrack(() => initializeOwnedComponent(child, () => create(child)));
        if (!node || node.nodeType !== 1) {
          throw new TypeError("Exit-aware region requires one native Element");
        }
        region.parent.insertBefore(node, region.end);
        current = { owner: child, node };
        mountChild(owner, child);
      } catch (error) {
        let cleanupError: unknown;
        current = null;
        try { disposeOwner(child); } catch (caught) { cleanupError = caught; }
        removeBetween(region.start, region.end);
        if (cleanupError !== undefined) {
          throw new AggregateError([error, cleanupError], "Exit-aware region mount failed");
        }
        throw error;
      }
      return;
    }
    if (!current || pending) return;
    const ticket = ++revision;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      try { settle(ticket, true); } catch (error) { failed(error); }
    }, maxExitMs);
    pending = { revision: ticket, controller, timer };
    let completion: void | Promise<void>;
    try {
      completion = untrack(() => exit(current!.node, controller.signal));
    } catch (error) {
      failed(error);
      settle(ticket);
      return;
    }
    void Promise.resolve(completion).then(
      () => settle(ticket),
      error => {
        // Superseded callbacks must not report stale cancellation errors.
        if (!pending || pending.revision !== ticket) return;
        failed(error);
        settle(ticket);
      }
    ).catch(failed);
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

/**
 * Full movement of a heavily permuted keyed list is cheaper when the DOM is
 * detached once and inserted once. Preserve the exact nodes and owner scopes.
 * Only used when most neighbor relationships have changed; small/local moves
 * still use precise range operations with no unrelated childList mutations.
 */
function moveManyRanges<Key, Item>(
  parent: Node, regionStart: Comment, regionEnd: Comment,
  entries: readonly RecordEntry<Key, Item>[]
): void {
  const doc = parent.ownerDocument ?? (parent as Document);
  for (const entry of entries) {
    if (entry.start.parentNode !== parent || entry.end.parentNode !== parent) {
      throw new Error("Cannot batch-move a detached keyed range");
    }
  }
  // Extract all complete sibling nodes in one native Range operation before
  // rearranging item ranges while detached. Preserve node and owner identity.
  const range = doc.createRange();
  range.setStartAfter(regionStart);
  range.setEndBefore(regionEnd);
  const detached = range.extractContents();
  const reordered = doc.createDocumentFragment();
  for (const entry of entries) {
    if (entry.start.parentNode !== detached || entry.end.parentNode !== detached) {
      throw new Error("Keyed region extraction did not preserve item boundaries");
    }
    let cursor: Node | null = entry.start;
    while (cursor) {
      const next: Node | null = cursor.nextSibling;
      reordered.appendChild(cursor);
      if (cursor === entry.end) break;
      cursor = next;
    }
  }
  parent.insertBefore(reordered, regionEnd);
}

/**
 * Sparse reorders must preserve the maximal already-ordered subsequence.
 * In particular, prepending must move the new row only, not every old row.
 * Compute a longest increasing subsequence of current DOM indices, then move
 * only non-LIS keyed ranges from right to left. O(n log n) planning.
 */
function moveMinimumRanges<Key, Item>(
  region: DomRegion, ordered: readonly RecordEntry<Key, Item>[]
): void {
  const byStart = new Map<Node, RecordEntry<Key, Item>>();
  for (const entry of ordered) byStart.set(entry.start, entry);
  const indices = new Map<RecordEntry<Key, Item>, number>();
  let node = region.start.nextSibling;
  while (node && node !== region.end) {
    const entry = byStart.get(node);
    if (!entry) throw new Error("Unexpected node between keyed region markers");
    indices.set(entry, indices.size);
    node = entry.end.nextSibling;
  }
  if (indices.size !== ordered.length || node !== region.end) {
    throw new Error("Keyed region layout does not match tracked owners");
  }
  const positions = ordered.map(entry => {
    const index = indices.get(entry);
    if (index === undefined) throw new Error("Detached keyed range");
    return index;
  });
  const tails: number[] = [];
  const predecessor = new Array<number>(ordered.length).fill(-1);
  for (let i = 0; i < positions.length; i++) {
    const value = positions[i]!;
    let low = 0;
    let high = tails.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (positions[tails[mid]!]! < value) low = mid + 1;
      else high = mid;
    }
    if (low > 0) predecessor[i] = tails[low - 1]!;
    tails[low] = i;
  }
  const keep = new Set<number>();
  for (let i = tails[tails.length - 1] ?? -1; i >= 0; i = predecessor[i] ?? -1) {
    keep.add(i);
  }
  let before: Node = region.end;
  for (let i = ordered.length - 1; i >= 0; i--) {
    const entry = ordered[i]!;
    if (!keep.has(i)) moveRange(region.parent, entry.start, entry.end, before);
    before = entry.start;
  }
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

      // Coalesce severely permuted lists into one native insertion. For local
      // changes retain exact per-range placement, preserving the zero-unrelated-
      // mutations invariant and avoiding work on already sorted siblings.
      let disruptedNeighbors = 0;
      for (let i = 0; i + 1 < ordered.length; i++) {
        if (ordered[i]!.end.nextSibling !== ordered[i + 1]!.start) disruptedNeighbors++;
      }
      if (ordered.length === 0 ||
          (disruptedNeighbors === 0 && ordered[0]?.start.previousSibling === region.start &&
           ordered[ordered.length - 1]?.end.nextSibling === region.end)) {
        // Updating one item or appending to an already sorted list moves nothing.
      } else if (ordered.length >= 64 && disruptedNeighbors * 2 > ordered.length) {
        moveManyRanges(region.parent, region.start, region.end, ordered);
      } else {
        moveMinimumRanges(region, ordered);
      }
    } finally {
      restoreFocus(focused);
    }
  }, clear);
}
