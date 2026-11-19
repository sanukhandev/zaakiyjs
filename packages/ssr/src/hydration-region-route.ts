/** Transactional H5 route commit for compiler-generated H4 conditional/keyed regions.
 * A stale navigation must never attach listeners or adopt native SSR nodes.
 * Loader/guard work belongs to the public Router and must finish before commit.
 */
import type { HydrationMountHandle } from "@zaakiyjs/dom";
import { hydrateRegionPage } from "./hydrate-region.js";
import type { RegionHydrationPlanV2, RegionHydrationBindingsV2 } from "./hydrate-region.js";
import type { HydrationEnvelopeV1, TrustedServerBuildManifestV1 } from "./protocol.js";
import type { HydrationTransition } from "./hydration-transitions.js";

/**
 * The supplied transaction belongs to the matched Router route ID.
 * Commit is synchronous: a competing navigation can invalidate the transaction
 * before invocation, but cannot interleave with native adoption during this call.
 * The transaction's signal is forwarded for deterministic post-commit disposal.
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
      !transaction.signal || typeof transaction.signal.aborted !== "boolean" ||
      transaction.routeId !== plan?.routeId ||
      envelope?.routeId !== transaction.routeId ||
      !bindings || typeof bindings.read !== "function") {
    throw new TypeError("Region hydration transaction route mismatch");
  }
  return transaction.commit(() =>
    hydrateRegionPage(container, plan, envelope, manifest, transaction.routeId,
      { ...bindings, signal: transaction.signal }));
}
