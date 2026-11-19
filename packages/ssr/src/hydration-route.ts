/** H5 navigation integration for restricted data-bound page hydration. */
import { hydrateDataPage } from "./hydrate-data.js";
import { hydrateRegionPage } from "./hydrate-region.js";
import { hydrateRegionPageWithState } from "./hydrate-region-state.js";
import type { HydrationStateInitializer } from "./hydrate-region-state.js";
import type { RegionHydrationBindingsV2, RegionHydrationPlanV2 } from "./hydrate-region.js";
import type { HydrationMountHandle } from "@zaakiyjs/dom";
import type { DataHydrationBindings, DataHydrationHandle } from "./hydrate-data.js";
import type { DataHydrationPlanV1, HydrationEnvelopeV1,
  TrustedServerBuildManifestV1 } from "./protocol.js";
import type { HydrationTransition } from "./hydration-transitions.js";

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
 * Transactionally adopt compiler-backed H4/H5 keyed and conditional regions.
 * The transition controls the abort signal; user bindings cannot substitute it.
 * Stale navigation is rejected before the DOM is inspected or listeners attached.
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
      { ...bindings, signal: transaction.signal }));
}

/**
 * Current-only transaction for compiler IR v2 native-region adoption with
 * explicit approved public JSON state. Validate transaction identity before
 * parsing or initializing state, and bind ownership to navigation AbortSignal.
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
        // The host may not replace the transaction's ownership signal.
        signal: transaction.signal
      })));
}
