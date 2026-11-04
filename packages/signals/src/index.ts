/** M0 TYPE CONTRACT ONLY. signal/computed/effect implementations do not exist yet. */
export const foundationStatus = { package: "@zaakiyjs/signals", implemented: false } as const;
export interface ReadonlySignal<T> { readonly value: T; peek(): T }
export interface WritableSignal<T> extends ReadonlySignal<T> { value: T }
export type Equality<T> = (previous: T, next: T) => boolean;
export interface EffectHandle { dispose(): void }
export type EffectPhase = "render" | "user";
export interface EffectOptions { readonly phase?: EffectPhase; readonly onError?: (error: unknown) => void }
export type ComputedSignal<T> = ReadonlySignal<T>;
export type Untracked<T> = () => T;
