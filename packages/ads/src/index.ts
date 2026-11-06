/** Optional advertising orchestration. No SDKs or network activity at import time. */
export { createAdsManager } from "./manager.js";
export { renderAdSlotPlaceholder } from "./placeholder.js";
export { loadAuthorizedProviderScript } from "./scripts.js";
export { bindAdsToRoutes } from "./route.js";
export type {
  AdsConsentGate, ConsentDecision, AdFormat, AdMode, AdPhase, AdSlotConfig,
  AdSlotState, AdSize, ResponsiveAdSize, AdProvider, AdProviderContext,
  AdRequest, AdLoadResult, AdEvent, AdEventType, AdsManagerOptions, AdsManager, AdSlot
} from "./types.js";
export type { ProviderScriptOptions } from "./scripts.js";
export type { AdRouteSource, RouteAdsHandle } from "./route.js";

/** Frozen P3-00 native Ads/Consent capability protocol. */
export { createAdsManagerV1 } from "./v1.js";
export type {
  ConsentPurposeV1, ConsentDecisionV1, ConsentGrantV1, ConsentSnapshotV1,
  ConsentCapabilityV1, AdvertisingPurposeV1, AdSlotV1, AdSlotStateV1,
  AdProviderV1, AdProviderWithRefreshV1, AdPolicyV1, AdPlacementHandleV1,
  AdPlacementOptionsV1, AdsEventV1, AdsManagerOptionsV1, AdMountedPlacementV1,
  AdsManagerV1
} from "./contract-v1.js";

export { renderAdSlotPlaceholderV1 } from "./placeholder-v1.js";
export { bindAdsV1ToRoutes } from "./route-v1.js";
export type { AdRouteSourceV1, RouteAdsOptionsV1, RoutePlacementOptionsV1, AdRouteHandleV1 } from "./route-v1.js";
