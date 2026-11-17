/** H5 navigation integration for restricted data-bound page hydration. */
import { hydrateDataPage } from "./hydrate-data.js";
import { hydrateRegionPage } from "./hydrate-region.js";
import type { RegionHydrationPlanV2, RegionHydrationBindingsV2 } from "./hydrate-region.js";
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
 * H5: adopt compiler-verified interactive v2 regions only at a current Router
 * navigation commit. Previously mounted events/owners are tied to the exact
 * transition signal and disposed when the navigation is superseded or aborted.
 * Never call this before async route guards/loaders and streaming have settled.
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
