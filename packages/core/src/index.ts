/** M0 TYPE CONTRACT ONLY. Ownership, context and components are not operational. */
import type { ReadonlySignal, WritableSignal, ComputedSignal, EffectHandle, EffectOptions } from "@zaakiyjs/signals";
export type { ReadonlySignal, WritableSignal, ComputedSignal, EffectHandle, EffectOptions };
export const foundationStatus = { package: "@zaakiyjs/core", implemented: false } as const;
export type OwnerState = "created" | "initialized" | "mounted" | "active" | "deactivated" | "suspended" | "disposed";
export interface OwnerScope {
  readonly parent: OwnerScope | null;
  readonly state: OwnerState;
  readonly disposed: boolean;
  dispose(): void;
}
export interface ContextToken<T> { readonly key: symbol; readonly description?: string; readonly __type?: T }
export type Cleanup = () => void;
export interface ViewNode { readonly __zaakiyViewNode: unique symbol }
export type Component<Props extends object = Record<string, never>> = (props: Readonly<Props>) => ViewNode;
export type ComponentFactory<Props extends object> = (props: Readonly<Props>, owner: OwnerScope) => ViewNode;
