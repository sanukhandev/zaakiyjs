/** H5 navigation integration for restricted data-bound page hydration. */
import { hydrateDataPage } from "./hydrate-data.js";
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
