/** Browser-safe hydration compatibility probe. This does not adopt DOM nodes. */
import type { HydrationEnvelopeV1, TrustedServerBuildManifestV1 } from "./protocol.js";

export interface HydrationProbe {
  readonly compatible: boolean;
  readonly reason?: "BUILD_MISMATCH" | "ROUTE_MISMATCH" | "MARKER_MISMATCH" | "INVALID_PROTOCOL";
}
const SHA256 = /^[a-f0-9]{64}$/;
const MARKER_ID = /^[a-f0-9]{32,64}$/;
const ROUTE_ID = /^[a-zA-Z0-9][\w.-]{0,199}$/;

/**
 * A marker includes the compiler-stable ID and template digest:
 *   zaakiy-h:<markerId>:<templateDigest>
 * Old ID-only markers cannot attest the template and must fail closed.
 *
 * No nodes are adopted, listeners attached or boundaries modified here.
 */
export function inspectHydration(
  root: ParentNode, envelope: HydrationEnvelopeV1, manifest: TrustedServerBuildManifestV1, routeId: string
): HydrationProbe {
  if (!root || typeof (root as Node).nodeType !== "number" ||
      !manifest || manifest.schema !== "zaakiy.render-manifest/1" ||
      manifest.irVersion !== 1 || manifest.domAbiVersion !== 1 ||
      !SHA256.test(manifest.buildId) || !manifest.routes ||
      typeof manifest.routes !== "object" || Array.isArray(manifest.routes) ||
      !envelope || envelope.schema !== "zaakiy.hydration/1" ||
      envelope.domAbiVersion !== 1 || !SHA256.test(envelope.buildId) ||
      typeof envelope.routeId !== "string" ||
      !Array.isArray(envelope.boundaries) || envelope.boundaries.length > 4096) {
    return { compatible: false, reason: "INVALID_PROTOCOL" };
  }
  if (manifest.buildId !== envelope.buildId) return { compatible: false, reason: "BUILD_MISMATCH" };
  if (!ROUTE_ID.test(routeId) || envelope.routeId !== routeId ||
      !Object.hasOwn(manifest.routes, routeId) ||
      manifest.routes[routeId]?.routeId !== routeId) {
    return { compatible: false, reason: "ROUTE_MISMATCH" };
  }

  const expected = envelope.boundaries;
  const markerIds = new Set<string>();
  for (const marker of expected) {
    if (!marker || typeof marker.markerId !== "string" ||
        !MARKER_ID.test(marker.markerId) ||
        typeof marker.templateDigest !== "string" ||
        !SHA256.test(marker.templateDigest) || markerIds.has(marker.markerId)) {
      return { compatible: false, reason: "INVALID_PROTOCOL" };
    }
    markerIds.add(marker.markerId);
  }

  const node = root as Node;
  const ownerDocument = node.nodeType === 9 ? node as Document : node.ownerDocument;
  if (!ownerDocument) return { compatible: false, reason: "MARKER_MISMATCH" };
  const walker = ownerDocument.createTreeWalker(node, 128); // SHOW_COMMENT
  const found: Array<{ markerId: string; templateDigest: string }> = [];
  let current = walker.nextNode();
  while (current) {
    const marker = current.nodeValue ?? "";
    if (marker.startsWith("zaakiy-h:")) {
      const match = /^zaakiy-h:([a-f0-9]{32,64}):([a-f0-9]{64})$/.exec(marker);
      if (!match || found.length >= 4096) {
        return { compatible: false, reason: "MARKER_MISMATCH" };
      }
      found.push({ markerId: match[1]!, templateDigest: match[2]! });
    }
    current = walker.nextNode();
  }
  const seen = new Set(found.map(item => item.markerId));
  if (seen.size !== found.length || expected.length !== found.length ||
      expected.some((marker, index) =>
        marker.markerId !== found[index]?.markerId ||
        marker.templateDigest !== found[index]?.templateDigest)) {
    return { compatible: false, reason: "MARKER_MISMATCH" };
  }
  return { compatible: true };
}

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

export { hydrateDataRoute } from "./hydration-route.js";

export { hydrateRegionPage } from "./hydrate-region.js";
export type { RegionNodeV2, RegionHydrationPlanV2, RegionHydrationEventV2, RegionHydrationBindingsV2 } from "./hydrate-region.js";

export { hydrateRegionPageWithState } from "./hydrate-region-state.js";
export type { HydrationStateInitializer } from "./hydrate-region-state.js";

export { hydrateRegionPageRecoverBoundary } from "./hydrate-region-recovery.js";
export type { RegionRecoveryOptions } from "./hydrate-region-recovery.js";
