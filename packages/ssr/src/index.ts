/** Browser-safe protocol/types. Server code is exported only at @zaakiyjs/ssr/node. */
export const RENDER_PROTOCOL = "zaakiy.render/1" as const;
export const HYDRATION_PROTOCOL = "zaakiy.hydration/1" as const;
export const MANIFEST_PROTOCOL = "zaakiy.render-manifest/1" as const;
export type {
  RenderModeV1, CacheScopeV1, HydrationMismatchV1, RenderCachePolicyV1,
  RenderRoutePolicyV1, TrustedServerBuildManifestV1, ServerRequestContextV1,
  TrustedServerRenderModuleV1, RenderInvalidationRequestV1, RenderCacheInvalidatorV1,
  RenderResponseV1, RenderHeadEntryV1, RenderHeadAdapterV1, HydrationEnvelopeV1,
  NodeServerAdapterV1, TrustedModuleRegistration,
  DataHydrationNodeV1, DataHydrationPlanV1, DataHydrationElementV1,
  DataHydrationTextV1, DataHydrationSlotV1
} from "./protocol.js";
