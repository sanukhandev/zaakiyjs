/** Scoped, action-only state built on ZaakiyJS Signals and Core ownership. */
import { batch, computed, signal } from "@zaakiyjs/signals";
import type { ReadonlySignal, WritableSignal } from "@zaakiyjs/signals";
import {
  createContext, getOwner, onCleanup, provide, requireContext,
  runWithOwner, useContext
} from "@zaakiyjs/core";
import type { ContextToken, OwnerScope } from "@zaakiyjs/core";

/** Runtime values are plain, acyclic, data-only objects/arrays or primitives. */
export type DeepReadonly<T> = T extends (...args: never[]) => unknown ? never
  : T extends readonly (infer Item)[] ? readonly DeepReadonly<Item>[]
  : T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> } : T;

export type ReadonlyStoreState<S extends object> = Readonly<{
  [K in keyof S]: ReadonlySignal<DeepReadonly<S[K]>>;
}>;

export interface StoreWriter<S extends object> {
  get<K extends keyof S>(field: K): DeepReadonly<S[K]>;
  set<K extends keyof S>(field: K, value: S[K]): void;
  update<K extends keyof S>(field: K, change: (previous: DeepReadonly<S[K]>) => S[K]): void;
  patch(next: Partial<S>): void;
}

type ActionMethods<A> = { readonly [K in keyof A]: A[K] };
type ActionDefinitions = Record<string, (...args: never[]) => unknown>;

export interface Store<S extends object, A extends ActionDefinitions> {
  readonly owner: OwnerScope;
  readonly disposed: boolean;
  readonly state: ReadonlyStoreState<S>;
  readonly actions: ActionMethods<A>;
  /** An uncached selector factory. Each invocation creates one lazy computed. */
  select<T>(read: (state: ReadonlyStoreState<S>) => T): ReadonlySignal<T>;
  /** Set every field back to its captured, immutable initial value. */
  reset(): void;
  /** Stop actions and reads. Owner disposal also calls this method. */
  dispose(): void;
}

export interface CreateStoreOptions<S extends object, A extends ActionDefinitions> {
  /** New state per owner; use a factory to avoid accidental shared initial objects. */
  readonly state: S | (() => S);
  /** Runs once and must return an object of explicit actions. */
  readonly actions: (write: StoreWriter<S>) => A;
  /** Defaults to the synchronous lexical owner; never defaults to a process global. */
  readonly owner?: OwnerScope;
}

/** Copy and freeze plain data to prevent writable references escaping the store. */
function immutableCopy<T>(value: T, ancestors = new Set<object>()): T {
  if (value === null || value === undefined || typeof value === "string" ||
      typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return value;
  if (typeof value !== "object") throw new TypeError("Store state must contain only plain data");
  const prototype: unknown = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
    throw new TypeError("Store state must contain only plain objects and arrays");
  }
  if (ancestors.has(value)) throw new TypeError("Cyclic store state is not supported");
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index++) {
      if (!Object.prototype.hasOwnProperty.call(value, index)) throw new TypeError("Sparse store arrays are not supported");
    }
  }
  ancestors.add(value);
  try {
    const output: Record<string, unknown> | unknown[] = Array.isArray(value)
      ? [] : Object.create(null) as Record<string, unknown>;
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== "string") throw new TypeError("Symbol keys are not supported in store state");
      if (Array.isArray(value) && key === "length") continue;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
        throw new TypeError("Store state cannot include accessors or non-enumerable data");
      }
      Object.defineProperty(output, key, {
        value: immutableCopy(descriptor.value as unknown, ancestors),
        enumerable: true, configurable: false, writable: false
      });
    }
    return Object.freeze(output) as T;
  } finally { ancestors.delete(value); }
}

function asRecord(value: object): Record<string, unknown> {
  if (Array.isArray(value) || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
    throw new TypeError("Store root state must be a plain object");
  }
  return value as Record<string, unknown>;
}

/** Create a state instance tied to an explicit owner or current component scope. */
export function createStore<S extends object, A extends ActionDefinitions>(
  options: CreateStoreOptions<S, A>
): Store<S, A> {
  const owner = options.owner ?? getOwner();
  if (!owner) throw new Error("createStore requires a live owner or runWithOwner");
  if (owner.disposed) throw new Error("Cannot create a store on a disposed owner");
  let closed = false;
  const assertOpen = (): void => {
    if (closed || owner.disposed) throw new Error("Store has been disposed");
  };
  const initialInput = typeof options.state === "function" ? (options.state as () => S)() : options.state;
  const initial = asRecord(immutableCopy(initialInput));
  const fields = Object.keys(initial) as (keyof S & string)[];
  const sources = new Map<keyof S, WritableSignal<unknown>>();
  const publicState: Record<string, ReadonlySignal<unknown>> = Object.create(null) as Record<string, ReadonlySignal<unknown>>;
  for (const key of fields) {
    const source = signal(initial[key]);
    sources.set(key, source);
    Object.defineProperty(publicState, key, { enumerable: true, value: Object.freeze({
      get value() { assertOpen(); return source.value; },
      peek() { assertOpen(); return source.peek(); }
    }) });
  }
  const state = Object.freeze(publicState) as ReadonlyStoreState<S>;
  let actionDepth = 0;
  const assertAction = (): void => {
    assertOpen();
    if (actionDepth === 0) throw new Error("State mutations require a declared action");
  };
  const lookup = <K extends keyof S>(key: K): WritableSignal<unknown> => {
    const source = sources.get(key);
    if (!source) throw new TypeError("Unknown store field: " + String(key));
    return source;
  };
  const writer: StoreWriter<S> = Object.freeze({
    get<K extends keyof S>(key: K): DeepReadonly<S[K]> {
      assertOpen();
      return lookup(key).peek() as DeepReadonly<S[K]>;
    },
    set<K extends keyof S>(key: K, value: S[K]): void {
      assertAction();
      const source = lookup(key);
      source.value = immutableCopy(value);
    },
    update<K extends keyof S>(key: K, change: (previous: DeepReadonly<S[K]>) => S[K]): void {
      assertAction();
      const source = lookup(key);
      const next = change(source.peek() as DeepReadonly<S[K]>);
      source.value = immutableCopy(next);
    },
    patch(next: Partial<S>): void {
      assertAction();
      const entries = Object.entries(asRecord(immutableCopy(next)));
      // Validation and cloning precede all writes; an invalid patch is not partially applied.
      const prepared = entries.map(([key, value]) => [lookup(key as keyof S), value] as const);
      for (const [source, value] of prepared) source.value = value;
    }
  });
  let actions: ActionMethods<A>;
  try {
    const definitions = options.actions(writer);
    if (definitions === null || typeof definitions !== "object") {
      throw new TypeError("Store actions must be an object of functions");
    }
    const wrapped: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const key of Reflect.ownKeys(definitions)) {
      if (typeof key !== "string") throw new TypeError("Symbol action names are not supported");
      const descriptor = Object.getOwnPropertyDescriptor(definitions, key);
      if (!descriptor || !descriptor.enumerable || !("value" in descriptor) || typeof descriptor.value !== "function") {
        throw new TypeError("Store actions must be enumerable functions without getters");
      }
      const execute = descriptor.value as (...arguments_: unknown[]) => unknown;
      Object.defineProperty(wrapped, key, { enumerable: true, value: (...args: unknown[]) => {
        assertOpen();
        return batch(() => {
          actionDepth++;
          try { return execute.apply(wrapped, args); }
          finally { actionDepth--; }
        });
      } });
    }
    actions = Object.freeze(wrapped) as ActionMethods<A>;
    runWithOwner(owner, () => onCleanup(() => { closed = true; }));
  } catch (error) {
    closed = true;
    throw error;
  }
  return Object.freeze({
    owner,
    get disposed() { return closed || owner.disposed; },
    state,
    actions,
    select<T>(read: (sourceState: ReadonlyStoreState<S>) => T): ReadonlySignal<T> {
      assertOpen();
      const memo = computed(() => { assertOpen(); return read(state); });
      return Object.freeze({
        get value() { assertOpen(); return memo.value; },
        peek() { assertOpen(); return memo.peek(); }
      });
    },
    reset(): void {
      assertOpen();
      batch(() => {
        for (const key of fields) lookup(key).value = immutableCopy(initial[key]);
      });
    },
    dispose(): void { closed = true; }
  });
}

/** Create a typed service-token; providers are stored only in Core owner scopes. */
export function createStoreContext<T>(description?: string): ContextToken<T> {
  return createContext<T>(description);
}
export function provideStore<T>(owner: OwnerScope, token: ContextToken<T>, value: T): void {
  provide(owner, token, value);
}
export function useStore<T>(owner: OwnerScope, token: ContextToken<T>): T | undefined {
  return useContext(owner, token);
}
export function requireStore<T>(owner: OwnerScope, token: ContextToken<T>): T {
  return requireContext(owner, token);
}

/** Once per application/request root, with no process-wide singleton registry. */
export function getOrCreateRootStore<T extends { readonly owner: OwnerScope }>(
  owner: OwnerScope, token: ContextToken<T>, create: (root: OwnerScope) => T
): T {
  if (owner.disposed) throw new Error("Cannot resolve store for a disposed owner");
  let root = owner;
  while (root.parent) root = root.parent;
  const existing = useContext(root, token);
  if (existing !== undefined) {
    if (existing.owner !== root) throw new Error("Root store provider has the wrong owner");
    return existing;
  }
  const store = runWithOwner(root, () => create(root));
  if (store.owner !== root) throw new Error("Root store must belong to application root");
  provide(root, token, store);
  return store;
}
