import type { OwnerScope } from "@zaakiyjs/core";
import type { ReadonlySignal } from "@zaakiyjs/signals";

export interface DisposableHandle { dispose(): void }
export type InteractionReason = "pointer" | "keyboard" | "programmatic" | "focus" | "dismiss";
export interface InteractionDetail {
  readonly reason: InteractionReason;
  readonly originalEvent?: Event;
}
export type ValueChange<T> = (next: T, detail: InteractionDetail) => void;
export type Controllable<T> =
  | { readonly value: ReadonlySignal<T>; readonly defaultValue?: never;
      readonly onValueChange: ValueChange<T> }
  | { readonly value?: never; readonly defaultValue?: T;
      readonly onValueChange?: ValueChange<T> };

export interface ElementController<E extends HTMLElement = HTMLElement> extends DisposableHandle {
  readonly owner: OwnerScope;
  readonly element: E;
}
