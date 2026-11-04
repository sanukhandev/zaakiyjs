import { assertLiveOwner, getOwnerProviders } from "./owner.js";
import type { OwnerScope } from "./owner.js";

export interface ContextToken<T> {
  readonly key: symbol;
  readonly description?: string;
  readonly __type?: T;
}

export function createContext<T>(description?: string): ContextToken<T> {
  return Object.freeze({ key: Symbol(description), ...(description === undefined ? {} : { description }) });
}

/** Provider entries are immutable for one owner lifetime; child scopes may shadow. */
export function provide<T>(owner: OwnerScope, key: ContextToken<T>, value: T): void {
  assertLiveOwner(owner);
  const providers = getOwnerProviders(owner);
  if (providers.has(key.key)) {
    throw new Error("Provider already registered in this owner: " + (key.description ?? "unnamed"));
  }
  providers.set(key.key, value);
}

function resolve<T>(owner: OwnerScope, key: ContextToken<T>): { found: true; value: T } | { found: false } {
  assertLiveOwner(owner);
  for (let scope: OwnerScope | null = owner; scope; scope = scope.parent) {
    const providers = getOwnerProviders(scope);
    if (providers.has(key.key)) return { found: true, value: providers.get(key.key) as T };
  }
  return { found: false };
}

export function useContext<T>(owner: OwnerScope, key: ContextToken<T>): T | undefined {
  const resolved = resolve(owner, key);
  return resolved.found ? resolved.value : undefined;
}

export class MissingProviderError extends Error {
  constructor(description: string) {
    super("Missing required provider: " + description);
    this.name = "MissingProviderError";
  }
}

export function requireContext<T>(owner: OwnerScope, key: ContextToken<T>): T {
  const result = resolve(owner, key);
  if (!result.found) throw new MissingProviderError(key.description ?? key.key.toString());
  return result.value;
}
