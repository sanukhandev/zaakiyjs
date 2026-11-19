// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { createHydrationTransitionCoordinator } from "../src/hydration-transitions.js";
import { hydrateRegionRoute } from "../src/hydration-region-route.js";
import type { RegionHydrationPlanV2 } from "../src/hydrate-region.js";
import type { HydrationEnvelopeV1, TrustedServerBuildManifestV1 } from "../src/protocol.js";

const buildId = "a".repeat(64);
const markerId = "b".repeat(32);
const digest = "c".repeat(64);
const elementId = "d".repeat(32);
const routeId = "products";
const plan: RegionHydrationPlanV2 = {
  schema: "zaakiy.region-hydration/2", routeId, markerId, templateDigest: digest,
  nodes: [{ kind: "element", id: elementId, tag: "button", attrs: [],
    children: [{ kind: "literal", value: "Save" }] }]
};
const envelope: HydrationEnvelopeV1 = {
  schema: "zaakiy.hydration/1", buildId, domAbiVersion: 1, routeId,
  boundaries: [{markerId, templateDigest: digest}], payload: null
};
const manifest: TrustedServerBuildManifestV1 = {
  schema: "zaakiy.render-manifest/1", buildId, domAbiVersion: 1, irVersion: 1,
  routes: { products: {routeId, sourceDigest: "f".repeat(64), moduleId: "compiled/products"} }
};
function fixture(): {container: Element; button: HTMLButtonElement} {
  const container = document.createElement("section");
  container.appendChild(document.createComment("zaakiy-h:" + markerId + ":" + digest));
  const button = document.createElement("button");
  button.textContent = "Save";
  container.appendChild(button);
  return {container, button};
}
describe("H5 compiler-region hydration route commit", () => {
  it("refuses stale commits without touching native DOM or attaching events", () => {
    const coordinator = createHydrationTransitionCoordinator();
    const {container, button} = fixture();
    const old = coordinator.start(routeId);
    const next = coordinator.start(routeId);
    const before = container.innerHTML;
    let clicks = 0;
    const bind = {read: () => "Save", events: [{
      elementId, name: "click", handler: () => { clicks++; }
    }]};
    expect(() => hydrateRegionRoute(container, plan, envelope, manifest, old, bind))
      .toThrow(/Stale or aborted hydration transaction/);
    expect(container.innerHTML).toBe(before);
    button.click();
    expect(clicks).toBe(0);
    const handle = hydrateRegionRoute(container, plan, envelope, manifest, next, bind);
    expect(handle.root).toBe(button);
    button.click();
    expect(clicks).toBe(1);
    expect(container.innerHTML).toBe(before);
    coordinator.start("other");
    button.click();
    expect(clicks).toBe(1);
    expect(container.innerHTML).toBe(before);
    handle.dispose();
    coordinator.dispose();
  });

  it("fails closed for wrong route, wrong build or aborted transaction", () => {
    const coordinator = createHydrationTransitionCoordinator();
    const {container} = fixture();
    const tx = coordinator.start(routeId);
    const before = container.innerHTML;
    expect(() => hydrateRegionRoute(container, {...plan,routeId:"other"},
      envelope, manifest, tx, {read:()=>null})).toThrow(/route mismatch/);
    expect(() => hydrateRegionRoute(container,plan,{...envelope,buildId:"0".repeat(64)},
      manifest,tx,{read:()=>null})).toThrow();
    expect(container.innerHTML).toBe(before);
    tx.abort();
    expect(() => hydrateRegionRoute(container, plan, envelope, manifest, tx,
      {read:()=>null})).toThrow(/Stale or aborted/);
    coordinator.dispose();
  });

  it("prevents double adoption of an owned region while a route is mounted", () => {
    const coordinator = createHydrationTransitionCoordinator();
    const {container,button} = fixture();
    const tx = coordinator.start(routeId);
    const bindings = {read:()=>null};
    const handle = hydrateRegionRoute(container,plan,envelope,manifest,tx,bindings);
    expect(handle.root).toBe(button);
    expect(() => hydrateRegionRoute(container,plan,envelope,manifest,tx,bindings)).toThrow();
    handle.dispose();
    coordinator.dispose();
  });
});
