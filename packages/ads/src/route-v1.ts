import type {
  AdMountedPlacementV1, AdPlacementOptionsV1, AdSlotV1, AdsManagerV1
} from "./contract-v1.js";

export interface AdRouteSourceV1 {
  /** Must describe a successfully committed route, not pending navigation. */
  currentRouteId(): string;
  subscribe(listener: (committedRouteId: string) => void): () => void;
}
export interface RouteAdsOptionsV1 {
  /** Explicit allowlist: private and sensitive routes have no default ad permission. */
  readonly allowRoutes: readonly string[];
}
export interface RoutePlacementOptionsV1 {
  readonly routeId?: string;
  readonly persistent?: boolean;
}
export interface AdRouteHandleV1 {
  register(slot: AdSlotV1, options?: AdPlacementOptionsV1, route?: RoutePlacementOptionsV1): AdMountedPlacementV1;
  dispose(): Promise<void>;
}
/** Router-neutral adapter. Never monkey-patches History or fetches private Router internals. */
export function bindAdsV1ToRoutes(
  manager: AdsManagerV1,
  source: AdRouteSourceV1,
  options: RouteAdsOptionsV1
): AdRouteHandleV1 {
  let active = source.currentRouteId();
  let ended = false;
  const placements = new Map<string, { slot: AdMountedPlacementV1; routeId: string; persistent: boolean }>();
  const permitted = (routeId: string): boolean => options.allowRoutes.includes(routeId);
  const unsubscribe = source.subscribe(next => {
    if (ended || next === active) return;
    active = next;
    for (const [id, entry] of placements) {
      // A persistent shell placement is only permitted while the *active*
      // committed route remains on the explicit public allowlist.
      if (!permitted(next) || (!entry.persistent && entry.routeId !== next)) {
        void entry.slot.dispose();
        placements.delete(id);
      }
    }
  });
  return {
    register(slot, slotOptions, routeOptions = {}) {
      if (ended) throw new Error("Ad route adapter disposed");
      const routeId = routeOptions.routeId ?? active;
      if (!permitted(active) || !permitted(routeId) || (!routeOptions.persistent && routeId !== active)) {
        throw new Error("Advertising is not authorized for this route");
      }
      const existing = placements.get(slot.id);
      if (existing && manager.get(slot.id) === existing.slot) return existing.slot;
      const placed = manager.register(slot, slotOptions);
      placements.set(slot.id, { slot: placed, routeId, persistent: !!routeOptions.persistent });
      return placed;
    },
    async dispose() {
      if (ended) return;
      ended = true; unsubscribe();
      await Promise.all([...placements.values()].map(entry => entry.slot.dispose()));
      placements.clear();
    }
  };
}
