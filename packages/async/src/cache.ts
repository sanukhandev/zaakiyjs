import { getOwner, onCleanup, runWithOwner } from "@zaakiyjs/core";
import type { OwnerScope } from "@zaakiyjs/core";
import { awaitAbortable } from "./abort.js";
import { BusyError, CancellationError, ConfigurationError, DisposedError } from "./errors.js";

export interface CacheOptions {
  /** Captured synchronously from Core when omitted; explicit owner works outside runWithOwner. */
  readonly owner?: OwnerScope | null;
  /** An explicit, private identity for standalone or SSR cache scopes without a Core owner. */
  readonly scope?: object;
  readonly maxEntries?: number;
  readonly cacheTimeMs?: number;
}
export interface CacheHit<T> { readonly value: T; readonly stale: boolean }
export interface CacheLease<T> { readonly promise: Promise<T>; release(): void }
export interface ResourceCache {
  readonly size: number;
  readonly disposed: boolean;
  get<T>(key: string, staleTimeMs?: number): CacheHit<T> | undefined;
  acquire<T>(key: string, load: (signal: AbortSignal) => Promise<T>, deduplicate?: boolean): CacheLease<T>;
  invalidate(key?: string): void;
  assertAccess(owner: OwnerScope | null, scope?: object): void;
  dispose(): void;
}
interface Entry { readonly value: unknown; readonly updatedAt: number; readonly expiresAt: number }
interface InFlight {
  readonly key: string;
  readonly controller: AbortController;
  readonly promise: Promise<unknown>;
  consumers: number;
}
function rootOf(owner: OwnerScope): OwnerScope {
  let root = owner;
  while (root.parent !== null) root = root.parent;
  return root;
}
class ScopedCache implements ResourceCache {
  private readonly values = new Map<string, Entry>();
  private readonly running = new Set<InFlight>();
  private readonly shared = new Map<string, InFlight>();
  private closed = false;
  constructor(
    private readonly root: OwnerScope | null,
    private readonly scope: object | undefined,
    private readonly maxEntries: number,
    private readonly cacheTimeMs: number
  ) {}
  get disposed(): boolean { return this.closed; }
  get size(): number { return this.values.size; }
  assertAccess(owner: OwnerScope | null, scope?: object): void {
    this.requireLive();
    if (this.root) {
      if (!owner || rootOf(owner) !== this.root || owner.disposed) {
        throw new ConfigurationError("Resource cache may only be used within its owning application/request root");
      }
    } else if (!this.scope || this.scope !== scope) {
      throw new ConfigurationError("Standalone resource cache requires its explicit scope identity");
    }
  }
  private requireLive(): void { if (this.closed) throw new DisposedError(); }
  private trim(now: number): void {
    for (const [key, entry] of this.values) if (entry.expiresAt <= now) this.values.delete(key);
    while (this.values.size > this.maxEntries) this.values.delete(this.values.keys().next().value!);
  }
  get<T>(key: string, staleTimeMs = 0): CacheHit<T> | undefined {
    this.requireLive();
    this.trim(Date.now());
    const entry = this.values.get(key);
    if (!entry) return undefined;
    this.values.delete(key);
    this.values.set(key, entry); // LRU
    return { value: entry.value as T, stale: Date.now() - entry.updatedAt >= staleTimeMs };
  }
  private put<T>(key: string, value: T): void {
    if (this.closed || this.cacheTimeMs === 0) return;
    const now = Date.now();
    this.trim(now);
    this.values.delete(key);
    this.values.set(key, { value, updatedAt: now, expiresAt: now + this.cacheTimeMs });
    this.trim(now);
  }
  acquire<T>(key: string, load: (signal: AbortSignal) => Promise<T>, deduplicate = true): CacheLease<T> {
    this.requireLive();
    let operation = deduplicate ? this.shared.get(key) : undefined;
    if (operation?.controller.signal.aborted) {
      this.shared.delete(key);
      operation = undefined;
    }
    if (!operation) {
      if (this.running.size >= this.maxEntries) throw new BusyError("QUEUE_FULL");
      const controller = new AbortController();
      const promise = awaitAbortable(Promise.resolve().then(() => load(controller.signal)), controller.signal);
      const created: InFlight = { key, controller, promise, consumers: 0 };
      operation = created;
      this.running.add(created);
      if (deduplicate) this.shared.set(key, created);
      void promise.then(value => {
        if (!controller.signal.aborted && !this.closed) this.put(key, value);
      }, () => { /* Consumers receive the original rejection; also observe orphaned producers. */ })
        .then(() => {
          this.running.delete(created);
          if (this.shared.get(key) === created) this.shared.delete(key);
        });
    }
    operation.consumers++;
    const current = operation;
    let released = false;
    return {
      promise: current.promise as Promise<T>,
      release: () => {
        if (released) return;
        released = true;
        current.consumers--;
        if (current.consumers === 0) {
          if (!current.controller.signal.aborted) current.controller.abort(new CancellationError("manual"));
          this.running.delete(current);
          if (this.shared.get(key) === current) this.shared.delete(key);
        }
      }
    };
  }
  invalidate(key?: string): void {
    this.requireLive();
    if (key === undefined) this.values.clear();
    else this.values.delete(key);
    for (const pending of [...this.running]) {
      if (key !== undefined && pending.key !== key) continue;
      if (!pending.controller.signal.aborted) pending.controller.abort(new CancellationError("superseded"));
      this.running.delete(pending);
      if (this.shared.get(pending.key) === pending) this.shared.delete(pending.key);
    }
  }
  dispose(): void {
    if (this.closed) return;
    this.closed = true;
    for (const pending of this.running) {
      if (!pending.controller.signal.aborted) pending.controller.abort(new CancellationError("owner"));
    }
    this.running.clear();
    this.shared.clear();
    this.values.clear();
  }
}
/** No singleton registry: a new instance is isolated per owner root or explicit private scope. */
export function createResourceCache(options: CacheOptions = {}): ResourceCache {
  const owner = options.owner === undefined ? getOwner() : options.owner;
  if (!owner && !options.scope) throw new ConfigurationError("Cache requires a Core owner or explicit private scope");
  if (owner?.disposed) throw new DisposedError();
  const maxEntries = options.maxEntries ?? 100;
  const cacheTimeMs = options.cacheTimeMs ?? 300_000;
  if (!Number.isSafeInteger(maxEntries) || maxEntries < 1 || maxEntries > 100_000) {
    throw new ConfigurationError("maxEntries must be an integer in [1, 100000]");
  }
  if (!Number.isFinite(cacheTimeMs) || cacheTimeMs < 0) {
    throw new ConfigurationError("cacheTimeMs must be finite and nonnegative");
  }
  const cache = new ScopedCache(owner ? rootOf(owner) : null, options.scope, maxEntries, cacheTimeMs);
  if (owner) runWithOwner(owner, () => onCleanup(() => cache.dispose()));
  return cache;
}
