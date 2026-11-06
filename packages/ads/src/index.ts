/** P3-00 frozen protocol: optional, consent-aware advertisement orchestration. */
export { createAdsManagerV1, createAdsManagerV1 as createAdsManager } from "./v1.js";
export { renderAdSlotPlaceholderV1, renderAdSlotPlaceholderV1 as renderAdSlotPlaceholder } from "./placeholder-v1.js";
export { bindAdsV1ToRoutes, bindAdsV1ToRoutes as bindAdsToRoutes } from "./route-v1.js";
export { loadAuthorizedProviderScriptV1, loadAuthorizedProviderScriptV1 as loadAuthorizedProviderScript } from "./script-v1.js";
export type {
  ConsentPurposeV1, ConsentDecisionV1, ConsentGrantV1, ConsentSnapshotV1,
  ConsentCapabilityV1, AdvertisingPurposeV1, AdSlotV1, AdSlotStateV1,
  AdProviderV1, AdProviderWithRefreshV1, AdPolicyV1, AdPlacementHandleV1,
  AdPlacementOptionsV1, AdsEventV1, AdsManagerOptionsV1, AdMountedPlacementV1,
  AdsManagerV1
} from "./contract-v1.js";
export type { AdRouteSourceV1, RouteAdsOptionsV1, RoutePlacementOptionsV1, AdRouteHandleV1 } from "./route-v1.js";
export type { AdScriptOptionsV1, AdScriptLeaseV1 } from "./script-v1.js";
