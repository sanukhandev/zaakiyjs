import { getOwner, onCleanup, runWithOwner } from "@zaakiyjs/core";
import type { OwnerScope } from "@zaakiyjs/core";
import { DisposedError } from "./errors.js";
export function ownerFor(explicit: OwnerScope | null | undefined): OwnerScope | null {
  const owner = explicit === undefined ? getOwner() : explicit;
  if (owner?.disposed) throw new DisposedError();
  return owner;
}
/** Detachable cleanup slot; manual disposal no longer retains the handle in Core's cleanup stack. */
export function attachOwner(owner: OwnerScope | null, dispose: () => void): () => void {
  const slot: { dispose?: () => void } = { dispose };
  if (owner) runWithOwner(owner, () => onCleanup(() => slot.dispose?.()));
  return () => { slot.dispose = undefined; };
}
