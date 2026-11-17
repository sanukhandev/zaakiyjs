// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { signal, flushSync } from "@zaakiyjs/signals";
import { createHydrationTransitionCoordinator } from "../src/hydration-transitions.js";
import { hydrateRegionRoute } from "../src/hydration-route.js";
import type { RegionHydrationPlanV2 } from "../src/hydrate-region.js";
import type { HydrationEnvelopeV1, TrustedServerBuildManifestV1 } from "../src/protocol.js";

const buildId = "a".repeat(64);
const markerId = "b".repeat(32);
const digest = "c".repeat(64);
const buttonId = "d".repeat(32);
const slotId = "e".repeat(32);
const routeId = "products";
const plan: RegionHydrationPlanV2 = {
  schema: "zaakiy.region-hydration/2",
  routeId, markerId, templateDigest: digest,
  nodes: [{kind: "element", id: buttonId, tag: "button", attrs: [], children: [
    {kind: "data", id: slotId, source: "props", path: ["label"]}
  ]}]
};
const manifest: TrustedServerBuildManifestV1 = {
  schema: "zaakiy.render-manifest/1", buildId, irVersion: 1, domAbiVersion: 1,
  routes: {products: {routeId, moduleId: "verified/module", sourceDigest: "f".repeat(64)}}
};
const envelope: HydrationEnvelopeV1 = {
  schema: "zaakiy.hydration/1", buildId, domAbiVersion: 1, routeId,
  boundaries: [{markerId, templateDigest: digest}], payload: null
};
function fixture() {
  const container = document.createElement("section");
  container.innerHTML = `<!--zaakiy-h:${markerId}:${digest}--><button><!--zaakiy-d2:${slotId}:start-->Save<!--zaakiy-d2:${slotId}:end--></button>`;
  document.body.appendChild(container);
  return {container, button: container.querySelector("button")!};
}

describe("H5 compiler-region route hydration integration", () => {
  it("does not adopt stale route and disposes exact owner/listeners on superseding navigation", () => {
    const coordinator = createHydrationTransitionCoordinator();
    const {container, button} = fixture();
    const data = signal("Save");
    const original = container.innerHTML;
    const originalText = [...button.childNodes].find(node => node.nodeType === Node.TEXT_NODE);
    button.focus();
    let clicks = 0;
    const bindings = {
      read: () => data.value,
      events: [{elementId: buttonId, name: "click", handler: (() => { clicks++; }) as EventListener}]
    };
    const stale = coordinator.start(routeId);
    const active = coordinator.start(routeId);
    expect(() => hydrateRegionRoute(container, plan, envelope, manifest, stale, bindings))
      .toThrow(/Stale or aborted/);
    expect(container.innerHTML).toBe(original);
    button.click();
    expect(clicks).toBe(0);
    const handle = hydrateRegionRoute(container, plan, envelope, manifest, active, bindings);
    expect(handle.root).toBe(button);
    expect(container.querySelector("button")).toBe(button);
    expect(document.activeElement).toBe(button);
    expect(container.innerHTML).toBe(original);
    button.click();
    expect(clicks).toBe(1);
    flushSync(() => { data.value = "Updated"; });
    expect(button.textContent).toBe("Updated");
    expect([...button.childNodes].find(node => node.nodeType === Node.TEXT_NODE)).toBe(originalText);
    coordinator.start("other");
    button.click();
    expect(clicks).toBe(1);
    flushSync(() => { data.value = "After navigation"; });
    expect(button.textContent).toBe("Updated");
    handle.dispose();
    coordinator.dispose();
    container.remove();
  });
  it("repeatedly adopts and aborts 100 navigations without duplicate event handlers or DOM replacement", () => {
    const coordinator = createHydrationTransitionCoordinator();
    const {container, button} = fixture();
    const baseline = container.innerHTML;
    let calls = 0;
    for (let cycle = 0; cycle < 100; cycle++) {
      const transaction = coordinator.start(routeId);
      const handle = hydrateRegionRoute(container, plan, envelope, manifest, transaction, {
        read: () => "Save",
        events: [{elementId: buttonId, name: "click", handler: () => { calls++; }}]
      });
      expect(handle.root).toBe(button);
      expect(container.innerHTML).toBe(baseline);
      button.click();
      expect(calls).toBe(cycle + 1);
      transaction.abort();
      button.click();
      expect(calls).toBe(cycle + 1);
      handle.dispose();
    }
    expect(container.querySelector("button")).toBe(button);
    expect(container.innerHTML).toBe(baseline);
    coordinator.dispose();
    container.remove();
  });
  it("rejects route and envelope disagreement without adopting or mutating DOM", () => {
    const coordinator = createHydrationTransitionCoordinator();
    const {container, button} = fixture();
    const before = container.innerHTML;
    const other = coordinator.start("other");
    expect(() => hydrateRegionRoute(container, plan, envelope, manifest, other, {
      read: () => "Save"
    })).toThrow(/route mismatch/);
    expect(container.innerHTML).toBe(before);
    const active = coordinator.start(routeId);
    expect(() => hydrateRegionRoute(container, plan, {...envelope, routeId: "other"}, manifest,
      active, {read: () => "Save"})).toThrow(/route mismatch/);
    const badBuild = {...manifest, buildId: "0".repeat(64)};
    expect(() => hydrateRegionRoute(container, plan, envelope, badBuild, active, {
      read: () => "Save"
    })).toThrow(/mismatch/);
    expect(container.innerHTML).toBe(before);
    expect(container.querySelector("button")).toBe(button);
    coordinator.dispose();
    container.remove();
  });
  it("refuses externally aborted transitions before attaching handlers", () => {
    const coordinator = createHydrationTransitionCoordinator();
    const cancel = new AbortController();
    const transaction = coordinator.start(routeId, cancel.signal);
    const {container, button} = fixture();
    let clicks = 0;
    cancel.abort(new Error("navigation cancelled"));
    const before = container.innerHTML;
    expect(() => hydrateRegionRoute(container, plan, envelope, manifest, transaction, {
      read: () => "Save",
      events: [{elementId: buttonId, name: "click", handler: () => { clicks++; }}]
    })).toThrow(/Stale or aborted/);
    button.click();
    expect(clicks).toBe(0);
    expect(container.innerHTML).toBe(before);
    coordinator.dispose();
    container.remove();
  });
});
