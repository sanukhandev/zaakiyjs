import { createOwner, disposeOwner, getOwner, onCleanup, runWithOwner } from "@zaakiyjs/core";
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

/**
 * Dynamically registered items get removable child owners. Unregistering one
 * detaches the child from its parent rather than retaining every old cleanup
 * closure and removed element until the application is unmounted.
 */
export function createRegistration(
  owner: OwnerScope | undefined,
  setup: (registrationOwner: OwnerScope) => () => void
): PrimitiveHandle {
  const parent = owner ?? getOwner();
  if (!parent || parent.disposed) throw new Error("Registration needs a live Core owner");
  const registrationOwner = createOwner(parent);
  try {
    const tearDown = runWithOwner(registrationOwner, () => setup(registrationOwner));
    runWithOwner(registrationOwner, () => onCleanup(tearDown));
  } catch (error) {
    disposeOwner(registrationOwner);
    throw error;
  }
  return { dispose() { disposeOwner(registrationOwner); } };
}

/** Removable dynamic entries; disposing their parent controller clears all children. */
export function createRegistrationGroup(owner?: OwnerScope): {
  add(setup: (registrationOwner: OwnerScope) => () => void): PrimitiveHandle;
  dispose(): void;
} {
  const parent = owner ?? getOwner();
  if (!parent || parent.disposed) throw new Error("Registration group needs a live Core owner");
  const handles = new Set<PrimitiveHandle>();
  let closed = false;
  return {
    add(setup) {
      if (closed || parent.disposed) throw new Error("Registration group disposed");
      const entry = createRegistration(parent, setup);
      let ended = false;
      const handle: PrimitiveHandle = {
        dispose() {
          if (ended) return;
          ended = true;
          handles.delete(handle);
          entry.dispose();
        }
      };
      handles.add(handle);
      return handle;
    },
    dispose() {
      if (closed) return;
      closed = true;
      for (const entry of [...handles]) entry.dispose();
    }
  };
}
