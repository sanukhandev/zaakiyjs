/** H5 navigation integration for restricted data-bound page hydration. */
import { hydrateDataPage } from "./hydrate-data.js";
import type { DataHydrationBindings, DataHydrationHandle } from "./hydrate-data.js";
import type { DataHydrationPlanV1, HydrationEnvelopeV1,
  TrustedServerBuildManifestV1 } from "./protocol.js";
import type { HydrationTransition } from "./hydration-transitions.js";
import type { HydrationMountHandle } from "@zaakiyjs/dom";
import { hydrateRegionPage } from "./hydrate-region.js";
import type { RegionHydrationPlanV2, RegionHydrationBindingsV2 } from "./hydrate-region.js";
import { hydrateRegionPageWithState } from "./hydrate-region-state.js";
import type { HydrationStateInitializer } from "./hydrate-region-state.js";

/**
 * Executes preflight and attachment as a single synchronous route commit.
 * Async loaders and streaming must complete before invoking this function;
 * a stale navigation can neither attach nor retain event listeners.
 */
export function hydrateDataRoute(
  container: Element,
  plan: DataHydrationPlanV1,
  envelope: HydrationEnvelopeV1,
  manifest: TrustedServerBuildManifestV1,
  transaction: HydrationTransition,
  bindings: Omit<DataHydrationBindings, "signal">
): DataHydrationHandle {
  if (!transaction || typeof transaction.commit !== "function" ||
      !transaction.signal || transaction.routeId !== plan?.routeId ||
      envelope?.routeId !== transaction.routeId) {
    throw new TypeError("Hydration transaction route mismatch");
  }
  return transaction.commit(() =>
    hydrateDataPage(container, plan, envelope, manifest, transaction.routeId,
      { ...bindings, signal: transaction.signal }));
}


/**
 * H5 native compiler-region route commit. Adopt conditional/keyed/component
 * SSR nodes once, using the current navigation transaction's AbortSignal.
 * No DOM writes or listeners occur for stale/superseded transactions.
 */
export function hydrateRegionRoute(
  container: Element,
  plan: RegionHydrationPlanV2,
  envelope: HydrationEnvelopeV1,
  manifest: TrustedServerBuildManifestV1,
  transaction: HydrationTransition,
  bindings: Omit<RegionHydrationBindingsV2, "signal">
): HydrationMountHandle {
  if (!transaction || typeof transaction.commit !== "function" ||
      !transaction.signal || transaction.routeId !== plan?.routeId ||
      envelope?.routeId !== transaction.routeId) {
    throw new TypeError("Region hydration transaction route mismatch");
  }
  return transaction.commit(() =>
    hydrateRegionPage(container, plan, envelope, manifest, transaction.routeId,
      {...bindings, signal: transaction.signal}));
}

/**
 * Compose approved public-state restoration and owner-scoped region adoption
 * with exactly one current navigation transaction. Initialization happens
 * only *after* the transition has passed its synchronous commit guard.
 */
export function hydrateRegionRouteWithState(
  container: Element,
  plan: RegionHydrationPlanV2,
  envelope: HydrationEnvelopeV1,
  manifest: TrustedServerBuildManifestV1,
  transaction: HydrationTransition,
  serializedPublicState: string,
  initialize: HydrationStateInitializer
): HydrationMountHandle {
  if (!transaction || typeof transaction.commit !== "function" ||
      !transaction.signal || transaction.routeId !== plan?.routeId ||
      envelope?.routeId !== transaction.routeId) {
    throw new TypeError("Region hydration state transaction route mismatch");
  }
  return transaction.commit(() =>
    hydrateRegionPageWithState(container, plan, envelope, manifest, transaction.routeId,
      serializedPublicState, value => ({
        ...initialize(value),
        // A caller may not substitute its own signal to bypass transaction ownership.
        signal: transaction.signal
      })));
}
