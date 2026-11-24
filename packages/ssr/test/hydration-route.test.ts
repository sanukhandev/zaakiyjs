// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { createHydrationTransitionCoordinator } from "../src/hydration-transitions.js";
import { hydrateDataRoute } from "../src/hydration-route.js";
import type { DataHydrationPlanV1, HydrationEnvelopeV1, TrustedServerBuildManifestV1 } from "../src/protocol.js";

const buildId = "a".repeat(64);
const elementId = "b".repeat(32);
const slotId = "c".repeat(32);
const markerId = "d".repeat(32);
const templateDigest = "e".repeat(64);
const routeId = "test";
const plan: DataHydrationPlanV1 = {
  schema: "zaakiy.data-hydration/1", routeId, markerId, templateDigest,
  root: { kind: "element", tag: "button", id: elementId, attributes: [],
    children: [{ kind: "slot", id: slotId, path: ["label"] }] }
};
const manifest: TrustedServerBuildManifestV1 = {
  schema: "zaakiy.render-manifest/1", buildId, irVersion: 1, domAbiVersion: 1,
  routes: { test: { moduleId: "compiled/test", sourceDigest: "f".repeat(64), routeId } }
};
const envelope: HydrationEnvelopeV1 = {
  schema: "zaakiy.hydration/1", buildId, domAbiVersion: 1, routeId,
  boundaries: [{ markerId, templateDigest }], payload: null
};
function fixture() {
  const container = document.createElement("section");
  container.append(document.createComment("zaakiy-h:" + markerId + ":" + templateDigest));
  const button = document.createElement("button");
  button.append(document.createComment("zaakiy-t:" + slotId + ":start"),
    document.createTextNode("Save"),
    document.createComment("zaakiy-t:" + slotId + ":end"));
  container.append(button);
  return { container, button };
}
describe("H5 restricted route hydration integration", () => {
  it("does not hydrate stale navigation; disposes listeners when route changes", () => {
    const coordinator = createHydrationTransitionCoordinator();
    const { container, button } = fixture();
    const old = coordinator.start(routeId);
    const newer = coordinator.start(routeId);
    const before = container.innerHTML;
    const bindings = { read: () => "Save" };
    expect(() => hydrateDataRoute(container, plan, envelope, manifest, old, bindings)).toThrow();
    expect(container.innerHTML).toBe(before);
    let count = 0;
    const handle = hydrateDataRoute(container, plan, envelope, manifest, newer, {
      ...bindings, events: [{ elementId, name: "click", handler: () => { count++; } }]
    });
    expect(handle.root).toBe(button);
    button.click();
    expect(count).toBe(1);
    coordinator.start("another");
    button.click();
    expect(count).toBe(1);
    expect(container.innerHTML).toBe(before);
    handle.dispose();
    coordinator.dispose();
  });
  it("rejects transaction and envelope route disagreement", () => {
    const coordinator = createHydrationTransitionCoordinator();
    const tx = coordinator.start("other");
    const { container } = fixture();
    expect(() => hydrateDataRoute(container, plan, envelope, manifest, tx,
      { read: () => "Save" })).toThrow(/route mismatch/);
    coordinator.dispose();
  });
});
