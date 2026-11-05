import { getOwner, onCleanup, runWithOwner } from "@zaakiyjs/core";
import type { OwnerScope } from "@zaakiyjs/core";

export interface PrimitiveHandle { dispose(): void }
export interface OwnedOptions { readonly owner?: OwnerScope }

/** Own a single idempotent cleanup; never infer ownership across await. */
export function own(tearDown: () => void, owner?: OwnerScope): PrimitiveHandle {
  const scope = owner ?? getOwner();
  if (!scope || scope.disposed) throw new Error("UI primitive requires a live Core owner");
  let disposed = false;
  const handle: PrimitiveHandle = {
    dispose() {
      if (disposed) return;
      disposed = true;
      tearDown();
    }
  };
  runWithOwner(scope, () => onCleanup(() => handle.dispose()));
  return handle;
}

export function listen(
  target: EventTarget, event: string, handler: EventListener,
  owner?: OwnerScope, options?: AddEventListenerOptions
): PrimitiveHandle {
  const scope = owner ?? getOwner();
  if (!scope || scope.disposed) throw new Error("Event binding requires a live Core owner");
  target.addEventListener(event, handler, options);
  try { return own(() => target.removeEventListener(event, handler, options), scope); }
  catch (error) { target.removeEventListener(event, handler, options); throw error; }
}

export function ownedTimeout(
  callback: () => void, delay: number, owner?: OwnerScope
): PrimitiveHandle {
  const scope = owner ?? getOwner();
  if (!scope || scope.disposed) throw new Error("Timer requires a live Core owner");
  const id = setTimeout(() => {
    if (!scope.disposed) callback();
  }, Math.max(0, delay));
  try { return own(() => clearTimeout(id), scope); }
  catch (error) { clearTimeout(id); throw error; }
}

/** Element IDs are scoped to a component/app; never rely on module-global counters. */
export function createIdScope(prefix: string, owner?: OwnerScope): {
  next(hint?: string): string; readonly prefix: string;
} {
  if (!/^[A-Za-z][\w-]*$/.test(prefix)) throw new TypeError("Invalid ID prefix");
  let index = 0;
  own(() => { index = -1; }, owner);
  return {
    prefix,
    next(hint = "id") {
      if (index < 0) throw new Error("ID scope has been disposed");
      if (!/^[A-Za-z][\w-]*$/.test(hint)) throw new TypeError("Invalid ID hint");
      return `${prefix}-${hint}-${++index}`;
    }
  };
}
