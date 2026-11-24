// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { inspectHydration } from "../src/client.js";
import type { HydrationEnvelopeV1, TrustedServerBuildManifestV1 } from "../src/protocol.js";

const buildId = "a".repeat(64);
const id = "b".repeat(32);
const digest = "c".repeat(64);
const secondId = "d".repeat(32);
const secondDigest = "e".repeat(64);

const manifest: TrustedServerBuildManifestV1 = {
  schema: "zaakiy.render-manifest/1", buildId, irVersion: 1, domAbiVersion: 1,
  routes: { product: { routeId: "product", moduleId: "compiled/product", sourceDigest: "f".repeat(64) } }
};
const envelope: HydrationEnvelopeV1 = {
  schema: "zaakiy.hydration/1", buildId, domAbiVersion: 1, routeId: "product",
  payload: { public: true },
  boundaries: [{ markerId: id, templateDigest: digest }]
};

const dom = (...markers: string[]) => {
  const root = document.createElement("main");
  for (const marker of markers) root.appendChild(document.createComment(marker));
  return root;
};
const signed = (markerId: string, templateDigest: string) =>
  "zaakiy-h:" + markerId + ":" + templateDigest;

describe("hydration compatibility fail-closed preflight", () => {
  it("accepts correct ordered marker/digest pairs without modifying the DOM", () => {
    const root = dom(signed(id, digest), signed(secondId, secondDigest));
    const input = { ...envelope, boundaries: [
      { markerId: id, templateDigest: digest },
      { markerId: secondId, templateDigest: secondDigest }
    ] };
    const before = root.innerHTML;
    expect(inspectHydration(root, input, manifest, "product")).toEqual({ compatible: true });
    expect(root.innerHTML).toBe(before);
  });

  it("rejects old ID-only markers and mismatched template digests", () => {
    expect(inspectHydration(dom("zaakiy-h:" + id), envelope, manifest, "product"))
      .toEqual({ compatible: false, reason: "MARKER_MISMATCH" });
    expect(inspectHydration(dom(signed(id, "0".repeat(64))), envelope, manifest, "product"))
      .toEqual({ compatible: false, reason: "MARKER_MISMATCH" });
    expect(inspectHydration(dom("zaakiy-h:" + id + ":invalid"), envelope, manifest, "product"))
      .toEqual({ compatible: false, reason: "MARKER_MISMATCH" });
  });

  it("rejects duplicate and out-of-order marker identities", () => {
    const duplicate = { ...envelope, boundaries: [
      ...envelope.boundaries, ...envelope.boundaries
    ] };
    expect(inspectHydration(dom(signed(id, digest), signed(id, digest)), duplicate, manifest, "product"))
      .toEqual({ compatible: false, reason: "INVALID_PROTOCOL" });
    const ordered = { ...envelope, boundaries: [
      { markerId: id, templateDigest: digest },
      { markerId: secondId, templateDigest: secondDigest }
    ] };
    expect(inspectHydration(dom(signed(secondId, secondDigest), signed(id, digest)), ordered, manifest, "product"))
      .toEqual({ compatible: false, reason: "MARKER_MISMATCH" });
  });

  it("rejects wrong builds, routes, or invalid manifest entries", () => {
    expect(inspectHydration(dom(signed(id, digest)), {
      ...envelope, buildId: "0".repeat(64)
    }, manifest, "product")).toEqual({ compatible: false, reason: "BUILD_MISMATCH" });
    expect(inspectHydration(dom(signed(id, digest)), envelope, manifest, "other"))
      .toEqual({ compatible: false, reason: "ROUTE_MISMATCH" });
    expect(inspectHydration(dom(signed(id, digest)), envelope, {
      ...manifest, routes: { product: { ...manifest.routes.product!, routeId: "other" } }
    }, "product")).toEqual({ compatible: false, reason: "ROUTE_MISMATCH" });
  });

  it("rejects malformed digests and excess declared marker counts", () => {
    const invalid = { ...envelope, boundaries: [{ markerId: id, templateDigest: "not-a-digest" }] };
    expect(inspectHydration(dom(signed(id, digest)), invalid, manifest, "product"))
      .toEqual({ compatible: false, reason: "INVALID_PROTOCOL" });
    const oversized = { ...envelope, boundaries: Array(4097).fill({ markerId: id, templateDigest: digest }) };
    expect(inspectHydration(dom(), oversized, manifest, "product"))
      .toEqual({ compatible: false, reason: "INVALID_PROTOCOL" });
  });
});
