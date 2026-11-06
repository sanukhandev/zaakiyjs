import type { AdSlot, AdSlotConfig, AdsManager } from "./types.js";

export interface AdRouteSource {
  currentRouteId(): string;
  subscribe(listener: (routeId: string) => void): () => void;
}
export interface RouteAdsHandle {
  register(config: AdSlotConfig): AdSlot;
  dispose(): void;
}
/** Optional public route adapter; no Router internals or navigation patching. */
export function bindAdsToRoutes(manager: AdsManager, source: AdRouteSource): RouteAdsHandle {
  let active = source.currentRouteId();
  let disposed = false;
  const owned = new Map<string, { slot: AdSlot; route: string; persistent: boolean }>();
  const unsubscribe = source.subscribe(next => {
    if (disposed || next === active) return;
    active = next;
    for (const [id, entry] of owned) {
      if (!entry.persistent && entry.route !== next) {
        entry.slot.dispose();
        owned.delete(id);
      }
    }
  });
  return {
    register(config) {
      if (disposed) throw new Error("Route ads adapter disposed");
      if (config.routeId && config.routeId !== active && !config.persistent) {
        throw new Error("Cannot register ad on inactive route");
      }
      const existing = owned.get(config.id);
      if (existing && manager.getSlot(config.id) === existing.slot) return existing.slot;
      owned.delete(config.id);
      const slot = manager.registerSlot(config);
      owned.set(config.id, { slot, route: config.routeId ?? active, persistent: !!config.persistent });
      return slot;
    },
    dispose() {
      if (disposed) return;
      disposed = true; unsubscribe();
      for (const entry of owned.values()) entry.slot.dispose();
      owned.clear();
    }
  };
}
