/** Browser-safe validation only. The current DOM ABI has no node-adoption/hydration runtime. */
import type { HydrationEnvelopeV1, TrustedServerBuildManifestV1 } from "./protocol.js";
export interface HydrationProbe {
  readonly compatible: boolean;
  readonly reason?: "BUILD_MISMATCH" | "ROUTE_MISMATCH" | "MARKER_MISMATCH" | "INVALID_PROTOCOL";
}
export function inspectHydration(
  root: ParentNode, envelope: HydrationEnvelopeV1, manifest: TrustedServerBuildManifestV1, routeId: string
): HydrationProbe {
  if (manifest.schema !== "zaakiy.render-manifest/1" || envelope.schema !== "zaakiy.hydration/1" ||
      envelope.domAbiVersion !== 1 || manifest.domAbiVersion !== 1 || manifest.irVersion !== 1)
    return { compatible: false, reason: "INVALID_PROTOCOL" };
  if (manifest.buildId !== envelope.buildId) return { compatible: false, reason: "BUILD_MISMATCH" };
  if (envelope.routeId !== routeId || !Object.hasOwn(manifest.routes, routeId))
    return { compatible: false, reason: "ROUTE_MISMATCH" };
  const expected = envelope.boundaries;
  const found: string[] = [];
  const node = root as Node;
  const ownerDocument = node.nodeType === 9 ? node as Document : node.ownerDocument;
  if (!ownerDocument) return { compatible: false, reason: "MARKER_MISMATCH" };
  const walker = ownerDocument.createTreeWalker(node, NodeFilter.SHOW_COMMENT);
  let current = walker.nextNode();
  while (current) {
    const match = /^zaakiy-h:([a-f0-9]{32,64})$/.exec(current.nodeValue ?? "");
    if (match) found.push(match[1]!);
    current = walker.nextNode();
  }
  const unique = new Set(found);
  if (unique.size !== found.length || expected.length !== found.length ||
      expected.some((boundary, index) => boundary.markerId !== found[index])) {
    return { compatible: false, reason: "MARKER_MISMATCH" };
  }
  return { compatible: true };
}
