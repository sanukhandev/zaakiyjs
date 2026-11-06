import type { RenderRoutePolicyV1 } from "./protocol.js";
const TAG = /^[a-z0-9][a-z0-9:_-]{0,119}$/;
const VARY = new Set(["accept-language", "x-locale"]);
export function validateRenderPolicy(policy: RenderRoutePolicyV1): void {
  if (policy.version !== 1 || !/^[a-zA-Z0-9][\w.-]*$/.test(policy.routeId) ||
      !["csr", "ssr", "ssg", "hybrid"].includes(policy.mode)) throw new TypeError("Invalid render policy");
  if (policy.hydration &&
      (typeof policy.hydration.enabled !== "boolean" ||
       !["abort", "replace-owned-boundary"].includes(policy.hydration.onMismatch)))
    throw new TypeError("Invalid hydration policy");
  const cache = policy.cache;
  if (!cache) return;
  if (!["public", "tenant", "user", "no-store"].includes(cache.scope) ||
      !Number.isSafeInteger(cache.ttlSeconds) || cache.ttlSeconds < 0 || cache.ttlSeconds > 604800 ||
      cache.tags.length > 32 || cache.tags.some(tag => !TAG.test(tag)) ||
      (cache.vary?.some(key => !VARY.has(key)) ?? false) ||
      (cache.staleWhileRevalidateSeconds !== undefined &&
       (!Number.isSafeInteger(cache.staleWhileRevalidateSeconds) ||
        cache.staleWhileRevalidateSeconds < 0 || cache.staleWhileRevalidateSeconds > 86400))) {
    throw new TypeError("Invalid or unsafe render cache policy");
  }
  if (cache.scope === "no-store" && cache.ttlSeconds !== 0) throw new TypeError("no-store requires zero TTL");
}
