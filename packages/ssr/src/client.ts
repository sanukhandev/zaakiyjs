/** Browser-safe hydration compatibility probe and public client exports. */
export { inspectHydration } from "./hydration-probe.js";
export type { HydrationProbe } from "./hydration-probe.js";

export { hydrateDataPage } from "./hydrate-data.js";
export type { DataHydrationBindings, DataHydrationHandle, HydrationEventV1 } from "./hydrate-data.js";

export { serializeHydrationState, parseHydrationState } from "./hydration-state.js";
export type { JsonHydrationValue, HydrationStatePacketV1 } from "./hydration-state.js";

export { createHydrationTransitionCoordinator } from "./hydration-transitions.js";
export type { HydrationTransition, HydrationTransitionCoordinator } from "./hydration-transitions.js";

export { createHydrationStreamAssembler } from "./hydration-stream.js";
export type { HydrationStreamFragment, HydrationStreamOptions, HydrationStreamAssembler } from "./hydration-stream.js";

export { hydrateOwnedBoundary } from "./hydration-boundary.js";
export type { OwnedHydrationBoundary, OwnedBoundaryHydrationOptions, OwnedBoundaryHydrationHandle } from "./hydration-boundary.js";

export { hydrateDataRoute, hydrateRegionRoute, hydrateRegionRouteWithState } from "./hydration-route.js";

export { hydrateRegionPage } from "./hydrate-region.js";
export type { RegionNodeV2, RegionHydrationPlanV2, RegionHydrationEventV2, RegionHydrationBindingsV2 } from "./hydrate-region.js";

export { hydrateRegionPageWithState } from "./hydrate-region-state.js";
export type { HydrationStateInitializer } from "./hydrate-region-state.js";

export { hydrateRegionPageRecoverBoundary } from "./hydrate-region-recovery.js";
export type { RegionRecoveryOptions } from "./hydrate-region-recovery.js";
