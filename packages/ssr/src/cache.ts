import type {
  CacheScopeV1, RenderCacheInvalidatorV1, RenderInvalidationRequestV1, RenderResponseV1
} from "./protocol.js";

export interface CacheIdentity {
  readonly routeId: string;
  readonly buildId: string;
  readonly scope: Exclude<CacheScopeV1, "no-store">;
  readonly partitionKey?: string;
  readonly tags: readonly string[];
  readonly ttlSeconds: number;
}
interface Entry { readonly identity: CacheIdentity; readonly response: RenderResponseV1; readonly expiresAt: number; }
const KEY = /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,199}$/;

/** Bounded, local-only response cache. In-memory entries are not distributed or durable. */
export class MemoryRenderCache {
  private readonly entries = new Map<string, Entry>();
  private readonly inflight = new Map<string, { promise: Promise<RenderResponseV1>; identity: CacheIdentity; state: { invalidated: boolean } }>();
  constructor(readonly maxEntries = 256, private readonly now: () => number = Date.now) {
    if (!Number.isSafeInteger(maxEntries) || maxEntries < 1 || maxEntries > 100_000)
      throw new TypeError("Invalid cache capacity");
  }
  get(key: string): RenderResponseV1 | undefined {
    const hit = this.entries.get(key);
    if (!hit) return undefined;
    if (hit.expiresAt <= this.now()) { this.entries.delete(key); return undefined; }
    this.entries.delete(key); this.entries.set(key, hit);
    return hit.response;
  }
  async getOrRender(key: string, identity: CacheIdentity, render: () => Promise<RenderResponseV1>): Promise<RenderResponseV1> {
    if (identity.scope !== "public" && !identity.partitionKey) throw new TypeError("Private cache partition is required");
    const cached = this.get(key);
    if (cached) return cached;
    const existing = this.inflight.get(key);
    if (existing) return existing.promise;
    const state = { invalidated: false };
    const pending = (async () => {
      const response = await render();
      if (typeof response.body !== "string") {
        throw new TypeError("Streaming responses cannot be shared by single-flight cache");
      }
      if (response.cache.scope !== identity.scope || response.status !== 200 ||
          Object.keys(response.headers).some(name => name.toLowerCase() === "set-cookie")) {
        return response; // uncacheable data is never persisted
      }
      const entry: Entry = { identity, response, expiresAt: this.now() + identity.ttlSeconds * 1000 };
      if (identity.ttlSeconds > 0 && !state.invalidated) {
        this.entries.delete(key); this.entries.set(key, entry);
        while (this.entries.size > this.maxEntries) {
          const oldest = this.entries.keys().next().value;
          if (oldest === undefined) break;
          this.entries.delete(oldest);
        }
      }
      return response;
    })();
    const flight = { promise: pending, identity, state };
    this.inflight.set(key, flight);
    try { return await pending; }
    finally { if (this.inflight.get(key) === flight) this.inflight.delete(key); }
  }
  invalidateTags(scope: Exclude<CacheScopeV1, "no-store">, partitionKey: string | undefined, tags: readonly string[]): number {
    if (scope !== "public" && !partitionKey) throw new TypeError("Invalidation partition required");
    const requested = new Set(tags);
    let count = 0;
    for (const [key, entry] of this.entries) {
      if (entry.identity.scope === scope && entry.identity.partitionKey === partitionKey &&
          entry.identity.tags.some(tag => requested.has(tag))) {
        this.entries.delete(key); count++;
      }
    }
    for (const [key, flight] of this.inflight) {
      if (flight.identity.scope === scope && flight.identity.partitionKey === partitionKey &&
          flight.identity.tags.some(tag => requested.has(tag))) {
        flight.state.invalidated = true;
        this.inflight.delete(key);
      }
    }
    return count;
  }
  get size(): number { return this.entries.size; }
}

/** The host must verify identity and entitlement; there is no public invalidation HTTP endpoint. */
export function createCacheInvalidator(cache: MemoryRenderCache, authorize: (
  request: RenderInvalidationRequestV1, signal: AbortSignal
) => Promise<boolean>, now: () => number = Date.now): RenderCacheInvalidatorV1 {
  const handled = new Map<string, number>();
  return {
    version: 1,
    async invalidate(request, signal) {
      if (signal.aborted) throw signal.reason;
      if (request.version !== 1 || !["public", "tenant", "user"].includes(request.scope) ||
          !KEY.test(request.principalId) || !KEY.test(request.idempotencyKey) ||
          (request.scope !== "public" && (!request.partitionKey || !KEY.test(request.partitionKey))) ||
          request.tags.length < 1 || request.tags.length > 32 ||
          request.tags.some(tag => !/^[a-z0-9][a-z0-9:_-]{0,119}$/.test(tag)) ||
          !Number.isFinite(Date.parse(request.issuedAt)) ||
          Math.abs(now() - Date.parse(request.issuedAt)) > 300_000) {
        throw new TypeError("Invalid cache invalidation request");
      }
      if (!await authorize(request, signal) || signal.aborted) throw new Error("Cache invalidation denied");
      const id = [request.scope, request.partitionKey ?? "", request.principalId, request.idempotencyKey].join("|");
      if (handled.has(id)) return { invalidatedCount: 0 };
      for (const [key, stamp] of handled) if (now() - stamp > 300_000) handled.delete(key);
      if (handled.size >= 4096) handled.delete(handled.keys().next().value!);
      handled.set(id, now());
      return { invalidatedCount: cache.invalidateTags(request.scope, request.partitionKey, request.tags) };
    }
  };
}
