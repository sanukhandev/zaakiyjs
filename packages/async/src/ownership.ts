import { createOwner, disposeOwner, getOwner, onCleanup, runWithOwner } from "@zaakiyjs/core";
import type { OwnerScope } from "@zaakiyjs/core";
import { DisposedError } from "./errors.js";

/** Core exposes synchronous owner initialization only. Async callbacks never inherit it. */
export function ownerFor(explicit: OwnerScope | null | undefined): OwnerScope | null {
  const owner = explicit === undefined ? getOwner() : explicit;
  if (owner?.disposed) throw new DisposedError();
  return owner;
}

/**
 * Create a short-lived child of the existing Core owner.
 *
 * A long-lived owner with repeatedly created/disposed operations must not grow
 * an unbounded onCleanup stack. Disposing the child detaches it from the parent
 * and removes its registered callbacks. This reuses Core ownership; it does not
 * introduce another scope or async-context implementation.
 */
export function attachOwner(owner: OwnerScope | null, dispose: () => void): () => void {
  if (!owner) return () => {};
  const lifecycle = createOwner(owner);
  try {
    runWithOwner(lifecycle, () => onCleanup(dispose));
  } catch (error) {
    disposeOwner(lifecycle);
    throw error;
  }
  // Disposing an already-disposing child is idempotent in Core.
  return () => disposeOwner(lifecycle);
}
