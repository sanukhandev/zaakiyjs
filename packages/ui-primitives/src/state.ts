import { signal } from "@zaakiyjs/signals";
import type { ReadonlySignal, WritableSignal } from "@zaakiyjs/signals";
import type { OwnerScope } from "@zaakiyjs/core";
import { own } from "./lifecycle.js";
import type { InteractionDetail, ValueChange } from "./contracts.js";

export interface ControlledStateOptions<T> {
  readonly owner?: OwnerScope;
  /** A readonly external signal selects controlled mode for the controller lifetime. */
  readonly value?: ReadonlySignal<T>;
  readonly defaultValue: T;
  /** Legacy state observer; use onValueChange for event-aware controllers. */
  readonly onChange?: (next: T, previous: T) => void;
  readonly onValueChange?: ValueChange<T>;
}
export interface ControlledState<T> {
  readonly controlled: boolean;
  readonly value: ReadonlySignal<T>;
  set(next: T, detail?: InteractionDetail): void;
}
/** A controlled write is only a request; parent owns the source Signal. */
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
    set(next, detail = { reason: "programmatic" }) {
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
      options.onValueChange?.(next, detail);
    }
  };
}
