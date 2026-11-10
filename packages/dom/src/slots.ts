/**
 * Additive native slot ownership primitive for compiler integration.
 *
 * This is an imperative DOM composition boundary, not a JSX children/IR v1
 * lowering. A native Node/DocumentFragment factory runs once in an owner
 * descended from the caller's lexical component scope. Portaled hosts do not
 * change that logical owner ancestry.
 */
import {
  createOwner, disposeOwner, initializeOwnedComponent,
  mountOwner, onCleanup, onMount, runWithOwner
} from "@zaakiyjs/core";
import type { OwnerScope } from "@zaakiyjs/core";
import { createRegion } from "./regions.js";

/** Only slots produced by this runtime may be mounted through generated outlets. */
const liveSlots = new WeakSet<object>();

export interface OwnedNativeSlot {
  readonly mounted: boolean;
  readonly disposed: boolean;
  /**
   * Single-use insertion. The factory runs exactly once; attempts to remount
   * or use the handle after parent disposal throw before mutating the DOM.
   */
  mount(host: Node, before?: Node | null): void;
  /** Idempotent, immediate disposal of child owner and the exact anchor range. */
  dispose(): void;
}

/**
 * Prepare a lazy native-node slot under its logical parent owner.
 * It can be inserted into any trusted host; ownership/DI inheritance stays
 * anchored to the caller rather than the host's physical location.
 *
 * Factory: trusted compiler-generated or application-authored native DOM only.
 * Do not feed executable HTML, raw strings or untrusted objects into this API.
 */
export function createOwnedNativeSlot(
  owner: OwnerScope,
  factory: (slotOwner: OwnerScope) => Node
): OwnedNativeSlot {
  if (owner.disposed) throw new Error("Cannot create slot from disposed owner");
  if (typeof factory !== "function") throw new TypeError("Slot factory must be callable");
  let closed = false;
  let consumed = false;
  let child: OwnerScope | null = null;
  let start: Comment | null = null;
  let end: Comment | null = null;
  const handle: OwnedNativeSlot = {
    get disposed() { return closed || owner.disposed; },
    get mounted() { return consumed && !closed; },
    mount(host: Node, before: Node | null = null) {
      if (closed || owner.disposed) throw new Error("Cannot mount a disposed slot");
      if (consumed) throw new Error("Native slot factory can mount only once");
      if (!host || typeof host.insertBefore !== "function" ||
          (before !== null && before.parentNode !== host)) {
        throw new TypeError("Native slot requires a valid host and insertion position");
      }
      consumed = true;
      const scope = createOwner(owner);
      child = scope;
      try {
        const region = createRegion(host, before);
        start = region.start;
        end = region.end;
        const node = initializeOwnedComponent(scope, () => factory(scope));
        if (!node || typeof node.nodeType !== "number" ||
            ![1, 3, 8, 11].includes(node.nodeType)) {
          throw new TypeError("Slot factory must return a native DOM Node or DocumentFragment");
        }
        host.insertBefore(node, region.end);
        if (owner.state === "created" || owner.state === "initialized") {
          runWithOwner(owner, () => onMount(() => {
            if (!scope.disposed) mountOwner(scope);
          }));
        } else {
          mountOwner(scope);
        }
      } catch (error) {
        try { handle.dispose(); }
        catch (cleanupError) {
          throw new AggregateError([error, cleanupError], "Slot mount and rollback failed");
        }
        throw error;
      }
    },
    dispose() {
      if (closed) return;
      closed = true;
      liveSlots.delete(handle);
      const errors: unknown[] = [];
      if (child) {
        try { disposeOwner(child); } catch (error) { errors.push(error); }
        child = null;
      }
      if (start && end) {
        // Never delete unrelated siblings if a host has externally reparented
        // or removed one of the slot anchors.
        let witness: Node | null = start;
        while (witness && witness !== end) witness = witness.nextSibling;
        if (witness === end && start.parentNode === end.parentNode) {
          let cursor: Node | null = start;
          while (cursor) {
            const next: Node | null = cursor.nextSibling;
            cursor.parentNode?.removeChild(cursor);
            if (cursor === end) break;
            cursor = next;
          }
        } else {
          start.parentNode?.removeChild(start);
          end.parentNode?.removeChild(end);
          errors.push(new Error("Native slot anchor range was externally modified"));
        }
        start = null;
        end = null;
      }
      if (errors.length === 1) throw errors[0];
      if (errors.length > 1) throw new AggregateError(errors, "Slot disposal failed");
    }
  };
  liveSlots.add(handle);
  runWithOwner(owner, () => onCleanup(() => handle.dispose()));
  return handle;
}

/** Compiler-facing insertion of a lazy, owner-scoped default JSX child slot. */
export function mountOwnedSlot(value: unknown, host: Node): void {
  if (!value || typeof value !== "object" || !liveSlots.has(value)) {
    throw new TypeError("Only an owned native slot may be inserted as JSX children");
  }
  (value as OwnedNativeSlot).mount(host);
}
