// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { hydrateDataPage } from "../src/hydrate-data.js";
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
function page() {
  const container = document.createElement("div");
  container.append(document.createComment("zaakiy-h:" + markerId + ":" + templateDigest));
  const button = document.createElement("button");
  button.append(document.createComment("zaakiy-t:" + slotId + ":start"),
    document.createTextNode("Save"),
    document.createComment("zaakiy-t:" + slotId + ":end"));
  container.append(button);
  return { container, button };
}

describe("H5 abort-driven hydration disposal", () => {
  it("adopts existing nodes, removes listeners on navigation abort and preserves HTML", () => {
    const { container, button } = page();
    const html = container.innerHTML;
    const abort = new AbortController();
    let clicks = 0;
    const handle = hydrateDataPage(container, plan, envelope, manifest, routeId, {
      read: path => path[0] === "label" ? "Save" : null,
      signal: abort.signal,
      events: [{ elementId, name: "click", handler: () => { clicks++; } }]
    });
    expect(handle.root).toBe(button);
    button.click();
    expect(clicks).toBe(1);
    abort.abort("route navigated");
    button.click();
    expect(clicks).toBe(1);
    expect(container.innerHTML).toBe(html);
    handle.dispose();
    // The prior owner is gone, so this root can be adopted again.
    const second = hydrateDataPage(container, plan, envelope, manifest, routeId, {
      read: () => "Save"
    });
    second.dispose();
  });
  it("does not adopt or mutate the route when signal already aborted", () => {
    const { container } = page();
    const original = container.innerHTML;
    const abort = new AbortController();
    abort.abort();
    expect(() => hydrateDataPage(container, plan, envelope, manifest, routeId, {
      read: () => "Save", signal: abort.signal
    })).toThrow("Hydration navigation aborted");
    expect(container.innerHTML).toBe(original);
  });
});
