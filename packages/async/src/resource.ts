import { effect, signal, untrack } from "@zaakiyjs/signals";
import type { EffectHandle, ReadonlySignal, WritableSignal } from "@zaakiyjs/signals";
import type { OwnerScope } from "@zaakiyjs/core";
import { createCancellation, awaitAbortable, abortedReason } from "./abort.js";
import type { Cancellation } from "./abort.js";
import type { ResourceCache, CacheLease } from "./cache.js";
import { CancellationError, ConfigurationError, DisposedError, classifyFailure, isCancellation } from "./errors.js";
import type { AsyncOperationError, CancellationKind } from "./errors.js";
import { attachOwner, ownerFor } from "./ownership.js";
import { runWithRetry, validateRetry } from "./retry.js";
import type { RetryOptions } from "./retry.js";

export type ResourceStatus = "idle" | "pending" | "refreshing" | "success" | "error" | "cancelled";
export interface LoadContext<TKey> {
  readonly key: TKey;
  readonly signal: AbortSignal;
  readonly attempt: number;
}
export interface ResourceOptions<TData, TKey = void> {
  readonly load: (context: LoadContext<TKey>) => Promise<TData>;
  /** Tracking is synchronous; keys are reevaluated by the existing Signals scheduler. */
  readonly key?: () => TKey | null | undefined;
  readonly equalsKey?: (a: TKey | null | undefined, b: TKey | null | undefined) => boolean;
  readonly enabled?: boolean | (() => boolean);
  readonly eager?: boolean;
  readonly keepPreviousData?: boolean;
  readonly owner?: OwnerScope | null;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
  readonly retry?: RetryOptions;
  readonly cache?: ResourceCache;
  /** Required with a cache. Must include authorization identity when necessary. */
  readonly cacheKey?: (key: TKey) => string;
  readonly cacheScope?: object;
  readonly deduplicate?: boolean;
  readonly staleTimeMs?: number;
}
export interface Resource<TData> {
  readonly data: ReadonlySignal<TData | undefined>;
  readonly lastSuccessful: ReadonlySignal<TData | undefined>;
  readonly pending: ReadonlySignal<boolean>;
  readonly refreshing: ReadonlySignal<boolean>;
  readonly error: ReadonlySignal<AsyncOperationError | null>;
  readonly status: ReadonlySignal<ResourceStatus>;
  readonly stale: ReadonlySignal<boolean>;
  /** Manual refresh bypasses completed cache entries but can join a matching in-flight load. */
  refresh(): Promise<TData>;
  /** Stop only this consumer, not a deduplicated request with other consumers. */
  cancel(): void;
  /** Mark cached data stale; eager resources revalidate. */
  invalidate(): void;
  dispose(): void;
}
function readonly<T>(source: WritableSignal<T>): ReadonlySignal<T> {
  return { get value() { return source.value; }, peek: () => source.peek() };
}
function validDuration(value: number | undefined, name: string): void {
  if (value !== undefined && (!Number.isFinite(value) || value < 0)) {
    throw new ConfigurationError(name + " must be finite and nonnegative");
  }
}
export function createResource<TData, TKey = void>(options: ResourceOptions<TData, TKey>): Resource<TData> {
  if (typeof options.load !== "function") throw new ConfigurationError("load must be a function");
  validateRetry(options.retry);
  validDuration(options.staleTimeMs, "staleTimeMs");
  if (options.cache && !options.cacheKey) throw new ConfigurationError("cacheKey is required for cached resources");
  const owner = ownerFor(options.owner);
  options.cache?.assertAccess(owner, options.cacheScope);
  // Validate timeouts before starting eager work.
  if (options.timeoutMs !== undefined && (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0)) {
    throw new ConfigurationError("timeoutMs must be finite and positive");
  }
  const data = signal<TData | undefined>(undefined);
  const lastSuccessful = signal<TData | undefined>(undefined);
  const pending = signal(false);
  const refreshing = signal(false);
  const error = signal<AsyncOperationError | null>(null);
  const status = signal<ResourceStatus>("idle");
  const stale = signal(true);
  let closed = false;
  let requested = false;
  let hasKey = false;
  let observedKey: TKey | null | undefined;
  let generation = 0;
  let active: Cancellation | null = null;
  let tracker: EffectHandle | null = null;
  let detachOwner = (): void => {};
  const equal = options.equalsKey ?? Object.is;

  const readKey = (): TKey | null | undefined => untrack(() => options.key?.());
  const isEnabled = (): boolean => untrack(() =>
    (typeof options.enabled === "function" ? options.enabled() : options.enabled) !== false
  );
  const usable = (key: TKey | null | undefined): key is TKey =>
    isEnabled() && (options.key === undefined || (key !== undefined && key !== null));
  const current = (id: number, key: TKey): boolean => {
    if (closed || owner?.disposed || id !== generation) return false;
    const latestKey = readKey();
    return usable(latestKey) && equal(key, latestKey);
  };

  function cancelActive(kind: CancellationKind): void {
    generation++;
    if (active) {
      const old = active;
      active = null;
      old.cancel(kind === "owner" ? "owner" : kind === "superseded" ? "superseded" : "manual");
    }
    pending.value = false;
    refreshing.value = false;
  }
  function launch(force: boolean): Promise<TData> {
    if (closed || owner?.disposed) return Promise.reject(new DisposedError());
    const key = readKey();
    if (!usable(key)) return Promise.reject(new ConfigurationError("Resource is disabled or has no key"));
    options.cache?.assertAccess(owner, options.cacheScope);
    requested = true;
    if (!hasKey || !equal(observedKey, key)) {
      hasKey = true;
      observedKey = key;
    }
    cancelActive("superseded");
    const id = generation;
    const cacheId = options.cacheKey?.(key);
    if (options.cache && (typeof cacheId !== "string" || cacheId.length === 0)) {
      return Promise.reject(new ConfigurationError("cacheKey must return a nonempty string"));
    }
    if (options.cache && cacheId !== undefined && !force) {
      const hit = options.cache.get<TData>(cacheId, options.staleTimeMs ?? 0);
      if (hit) {
        data.value = hit.value;
        lastSuccessful.value = hit.value;
        stale.value = hit.stale;
        if (!hit.stale) {
          status.value = "success";
          error.value = null;
          return Promise.resolve(hit.value);
        }
      }
    }
    if (options.keepPreviousData !== true && (options.cache === undefined || data.peek() === undefined)) data.value = undefined;
    const hadData = data.peek() !== undefined;
    pending.value = true;
    refreshing.value = hadData;
    status.value = hadData ? "refreshing" : "pending";
    error.value = null;
    const cancellation = createCancellation(options.signal, options.timeoutMs);
    active = cancellation;
    let lease: CacheLease<TData> | undefined;
    const load = (signal: AbortSignal): Promise<TData> =>
      runWithRetry(attempt => options.load({ key, signal, attempt }), signal, options.retry);
    try {
      if (options.cache && cacheId !== undefined) lease = options.cache.acquire(cacheId, load, options.deduplicate ?? true);
    } catch (cause) {
      active = null;
      cancellation.dispose();
      pending.value = false;
      refreshing.value = false;
      const failed = classifyFailure(cause, "RESOURCE_FAILED");
      error.value = failed;
      status.value = "error";
      return Promise.reject(failed);
    }
    const work = lease ? lease.promise : load(cancellation.signal);
    return awaitAbortable(work, cancellation.signal).then(
      value => {
        if (cancellation.signal.aborted) throw abortedReason(cancellation.signal);
        if (!current(id, key)) throw new CancellationError("superseded");
        data.value = value;
        lastSuccessful.value = value;
        stale.value = false;
        error.value = null;
        status.value = "success";
        return value;
      },
      cause => {
        // Manual/owner/timeout cancellation must retain its original classification.
        if (cancellation.signal.aborted) throw abortedReason(cancellation.signal);
        if (!current(id, key)) throw new CancellationError("superseded", cause);
        const failure = cause;
        if (isCancellation(failure)) {
          error.value = null;
          status.value = "cancelled";
          throw failure;
        }
        const typed = classifyFailure(failure, "RESOURCE_FAILED");
        error.value = typed;
        status.value = "error";
        throw typed;
      }
    ).finally(() => {
      lease?.release();
      cancellation.dispose();
      if (active === cancellation) active = null;
      if (id === generation && !closed) {
        pending.value = false;
        refreshing.value = false;
      }
    });
  }
  function dispose(): void {
    if (closed) return;
    closed = true;
    detachOwner();
    generation++;
    active?.cancel("owner");
    active = null;
    tracker?.dispose();
    tracker = null;
    // Do not mutate reactive state after the owning scope is gone.
  }
  function invalidate(): void {
    if (closed) throw new DisposedError();
    const key = readKey();
    if (usable(key)) {
      const cacheId = options.cacheKey?.(key);
      if (cacheId !== undefined) options.cache?.invalidate(cacheId);
    }
    stale.value = true;
    if (options.eager && usable(key)) void launch(false).catch(() => {});
  }
  const resource: Resource<TData> = {
    data: readonly(data), lastSuccessful: readonly(lastSuccessful),
    pending: readonly(pending), refreshing: readonly(refreshing),
    error: readonly(error), status: readonly(status), stale: readonly(stale),
    refresh: () => launch(true),
    cancel() {
      if (closed) throw new DisposedError();
      if (!active) return;
      cancelActive("manual");
      error.value = null;
      status.value = "cancelled";
    },
    invalidate, dispose
  };
  try {
    detachOwner = attachOwner(owner, dispose);
    tracker = effect(() => {
      const key = options.key?.();
      const enabled = typeof options.enabled === "function" ? options.enabled() : options.enabled;
      const allowed = enabled !== false && (options.key === undefined || (key !== undefined && key !== null));
      const changed = !hasKey || !equal(observedKey, key);
      hasKey = true;
      observedKey = key;
      if (!allowed) {
        cancelActive("superseded");
        status.value = "idle";
        return;
      }
      if (changed) {
        cancelActive("superseded");
        if (!options.keepPreviousData) data.value = undefined;
        stale.value = true;
      }
      if ((changed || status.peek() === "idle") && (options.eager || requested)) {
        void launch(false).catch(() => {}); // Eager background work is observed.
      }
    });
  } catch (cause) {
    dispose();
    throw cause;
  }
  return resource;
}
