import { signal } from "@zaakiyjs/signals";
import type { ReadonlySignal, WritableSignal } from "@zaakiyjs/signals";
import type { OwnerScope } from "@zaakiyjs/core";
import { own } from "./lifecycle.js";

export interface ControlledStateOptions<T> {
  readonly owner?: OwnerScope;
  /** Supplying this reactive external signal selects controlled mode for life. */
  readonly value?: ReadonlySignal<T>;
  readonly defaultValue: T;
  readonly onChange?: (next: T, previous: T) => void;
}
export interface ControlledState<T> {
  readonly controlled: boolean;
  readonly value: ReadonlySignal<T>;
  set(next: T): void;
}
/** A controlled write is a request: only the parent may update the external signal. */
export function createControlledState<T>(options: ControlledStateOptions<T>): ControlledState<T> {
  const internal: WritableSignal<T> = signal(options.defaultValue);
  const controlled = options.value;
  let closed = false;
  let lastObserved = controlled?.peek();
  let hasPending = false;
  let pending!: T;
  own(() => { closed = true; }, options.owner);
  return {
    controlled: controlled !== undefined,
    value: controlled ?? internal,
    set(next) {
      if (closed) return;
      const before = controlled ? controlled.peek() : internal.peek();
      if (controlled && !Object.is(before, lastObserved)) {
        lastObserved = before;
        hasPending = false;
      }
      if (Object.is(before, next) || (controlled && hasPending && Object.is(pending, next))) return;
      if (controlled) {
        pending = next;
        hasPending = true;
      } else {
        internal.value = next;
      }
      options.onChange?.(next, before);
    }
  };
}
