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
  private identityKey(key: string, identity: CacheIdentity): string {
    if (!key || key.length > 512 ||
        !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,199}$/.test(identity.routeId) ||
        !/^[a-f0-9]{64}$/.test(identity.buildId) ||
        !["public", "tenant", "user"].includes(identity.scope) ||
        (identity.scope !== "public" &&
          (!identity.partitionKey || !/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,199}$/.test(identity.partitionKey))) ||
        !Number.isSafeInteger(identity.ttlSeconds) || identity.ttlSeconds < 0 ||
        identity.ttlSeconds > 604800 ||
        identity.tags.length > 32 || identity.tags.some(tag => !/^[a-z0-9][a-z0-9:_-]{0,119}$/.test(tag))) {
      throw new TypeError("Invalid cache identity or private partition");
    }
    // Identity is integral to the storage key, including for direct API callers.
    // JSON-array encoding avoids ambiguity from delimiter-bearing keys.
    return JSON.stringify([
      identity.buildId, identity.routeId, identity.scope, identity.partitionKey ?? "",
      [...identity.tags].sort(), identity.ttlSeconds, key
    ]);
  }
  get(key: string, identity: CacheIdentity): RenderResponseV1 | undefined {
    const scoped = this.identityKey(key, identity);
    const hit = this.entries.get(scoped);
    if (!hit) return undefined;
    if (hit.expiresAt <= this.now()) { this.entries.delete(scoped); return undefined; }
    this.entries.delete(scoped); this.entries.set(scoped, hit);
    return hit.response;
  }
  async getOrRender(key: string, identity: CacheIdentity, render: () => Promise<RenderResponseV1>): Promise<RenderResponseV1> {
    const scoped = this.identityKey(key, identity);
    const cached = this.get(key, identity);
    if (cached) return cached;
    const existing = this.inflight.get(scoped);
    if (existing) {
      try { return await existing.promise; }
      catch {
        // A previous request may abort while another request still needs the
        // same document; retry independently rather than inherit its failure.
        if (this.inflight.get(scoped) === existing) this.inflight.delete(scoped);
        return this.getOrRender(key, identity, render);
      }
    }
    const state = { invalidated: false };
    const pending = (async () => {
      const response = await render();
      if (typeof response.body !== "string") {
        throw new TypeError("Streaming responses cannot be shared by single-flight cache");
      }
      const controls = Object.entries(response.headers).reduce(
        (acc, [name, value]) => name.toLowerCase() === "cache-control" ? acc + "," + value : acc, ""
      );
      const unsafeVary = Object.entries(response.headers).some(
        ([name, value]) => name.toLowerCase() === "vary" && value.split(",").some(part => part.trim() === "*")
      );
      if (response.cache.scope !== identity.scope || response.status !== 200 ||
          Object.keys(response.headers).some(name => name.toLowerCase() === "set-cookie") ||
          /(?:^|[,\s])(?:private|no-store|no-cache)(?:$|[,\s])/i.test(controls) || unsafeVary) {
        return response; // uncacheable data is never persisted
      }
      const entry: Entry = { identity, response, expiresAt: this.now() + identity.ttlSeconds * 1000 };
      if (identity.ttlSeconds > 0 && !state.invalidated) {
        this.entries.delete(scoped); this.entries.set(scoped, entry);
        while (this.entries.size > this.maxEntries) {
          const oldest = this.entries.keys().next().value;
          if (oldest === undefined) break;
          this.entries.delete(oldest);
        }
      }
      return response;
    })();
    const flight = { promise: pending, identity, state };
    this.inflight.set(scoped, flight);
    try { return await pending; }
    finally { if (this.inflight.get(scoped) === flight) this.inflight.delete(scoped); }
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
