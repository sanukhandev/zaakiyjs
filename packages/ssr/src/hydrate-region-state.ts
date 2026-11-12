/**
 * H4 opt-in public-state restoration before native region adoption.
 * No automatic global state merge and no implicit trust in serialized JSON.
 * The application must authorize public fields before serialization and
 * provide an owner-independent, disposable reactive initializer.
 */
import { parseHydrationState } from "./hydration-state.js";
import { hydrateRegionPage } from "./hydrate-region.js";
import type { RegionHydrationPlanV2, RegionHydrationBindingsV2 } from "./hydrate-region.js";
import type { HydrationEnvelopeV1, TrustedServerBuildManifestV1 } from "./protocol.js";
import type { HydrationMountHandle } from "@zaakiyjs/dom";

export interface HydrationStateInitializer {
  (validatedPublicData: ReturnType<typeof parseHydrationState>):
    RegionHydrationBindingsV2 & { readonly disposeState?: () => void };
}
/**
 * Restores only app-approved public JSON from a build/route-bound packet.
 * The initializer may create signals; its cleanup is mandatory if initialization
 * or DOM adoption fails. Private user/tenant authorization stays with the host.
 */
export function hydrateRegionPageWithState(
  container: Element,
  plan: RegionHydrationPlanV2,
  envelope: HydrationEnvelopeV1,
  manifest: TrustedServerBuildManifestV1,
  routeId: string,
  serializedPublicState: string,
  initialize: HydrationStateInitializer
): HydrationMountHandle {
  if (typeof initialize !== "function" ||
      !manifest || !envelope || manifest.buildId !== envelope.buildId ||
      plan?.routeId !== routeId || envelope.routeId !== routeId) {
    throw new TypeError("Hydration state deployment/route mismatch");
  }
  const parsed = parseHydrationState(serializedPublicState, manifest.buildId, routeId);
  const bindings = initialize(parsed);
  if (!bindings || typeof bindings.read !== "function") {
    bindings?.disposeState?.();
    throw new TypeError("Hydration state initializer must return a native read binding");
  }
  let handle: HydrationMountHandle;
  try {
    handle = hydrateRegionPage(container,plan,envelope,manifest,routeId,bindings);
  } catch (error) {
    try { bindings.disposeState?.(); }
    catch (cleanupError) {
      throw new AggregateError([error,cleanupError],"Hydration and state rollback failed");
    }
    throw error;
  }
  let closed=false;
  return {
    root:handle.root,owner:handle.owner,
    dispose() {
      if (closed) return;
      closed=true;
      let failure:unknown;
      try {handle.dispose();} catch(error){failure=error;}
      try {bindings.disposeState?.();} catch(error){
        if(failure!==undefined) throw new AggregateError([failure,error],"Hydration cleanup failed");
        throw error;
      }
      if(failure!==undefined) throw failure;
    }
  };
}
