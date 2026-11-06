// @vitest-environment jsdom
import { describe, afterEach, expect, it, vi } from "vitest";
import { createOwner, disposeOwner, runWithOwner } from "@zaakiyjs/core";
import { createAdsManagerV1 } from "../src/index.js";
import type {
  AdProviderV1, AdPolicyV1, AdSlotV1, AdvertisingPurposeV1,
  ConsentCapabilityV1, ConsentDecisionV1, ConsentPurposeV1, ConsentSnapshotV1
} from "../src/index.js";

const purposes: ConsentPurposeV1[] = [
  "essential", "analytics", "advertising", "ad-personalization", "functional-third-party"
];
class ConsentFixture implements ConsentCapabilityV1 {
  readonly schema = "zaakiy.consent/1" as const;
  revision = 0;
  readonly decisions = new Map<ConsentPurposeV1, ConsentDecisionV1>(
    purposes.map(p => [p, p === "essential" ? "granted" : "unknown"])
  );
  readonly callbacks = new Set<(next: ConsentSnapshotV1, previous: ConsentSnapshotV1) => void>();
  can(purpose: ConsentPurposeV1): boolean { return this.decisions.get(purpose) === "granted"; }
  snapshot(): ConsentSnapshotV1 {
    const grants = Object.fromEntries(purposes.map(p => [
      p, { purpose: p, decision: this.decisions.get(p)! }
    ])) as unknown as ConsentSnapshotV1["grants"];
    return { schema: this.schema, revision: this.revision, policyId: "test", policyVersion: "1", grants };
  }
  subscribe(fn: (next: ConsentSnapshotV1, previous: ConsentSnapshotV1) => void): () => void {
    this.callbacks.add(fn);
    return () => { this.callbacks.delete(fn); };
  }
  change(purpose: ConsentPurposeV1, decision: ConsentDecisionV1) {
    const previous = this.snapshot();
    this.decisions.set(purpose, decision);
    this.revision++;
    const next = this.snapshot();
    for (const fn of this.callbacks) fn(next, previous);
  }
  grant(...ps: ConsentPurposeV1[]) { for (const p of ps) this.change(p, "granted"); }
}
const basePolicy: AdPolicyV1 = {
  version: 1, providerId: "mock", allowPlacements: ["home/top", "home/rail"],
  requiredPurposes: ["advertising"], personalized: false, maxSlots: 2, loadTimeoutMs: 200
};
const baseSlot: AdSlotV1 = {
  schema: "zaakiy.ads/1", id: "homeTop", placement: "home/top",
  formats: ["display"], dimensions: [{ width: 300, height: 180 }],
  reserve: { minWidth: 300, minHeight: 180 }, requiredPurposes: ["advertising"], personalized: false
};
function fixture(policy: AdPolicyV1 = basePolicy) {
  const consent = new ConsentFixture();
  const provider: AdProviderV1 = {
    version: 1, id: "mock",
    start: vi.fn(async () => undefined),
    load: vi.fn(async () => "filled" as const),
    remove: vi.fn(async () => undefined),
    dispose: vi.fn(async () => undefined)
  };
  const manager = createAdsManagerV1({ consent, provider, policy, scopeId: "app1" });
  return { consent, provider, manager };
}
async function flush() { for (let i = 0; i < 35; i++) await Promise.resolve(); }
function host() { return document.createElement("aside"); }
afterEach(() => { vi.useRealTimers(); document.body.replaceChildren(); vi.restoreAllMocks(); });

describe("P3-00 frozen AdSlotV1 / ConsentCapabilityV1", () => {
  it("does not start, load or signal vendor activity before opt-in", async () => {
    const f = fixture();
    const placement = f.manager.register(baseSlot);
    const node = host();
    placement.mount(node);
    await flush();
    expect(placement.state.peek()).toBe("awaiting-consent");
    expect(f.provider.start).not.toHaveBeenCalled();
    expect(f.provider.load).not.toHaveBeenCalled();
    expect(node.style.minWidth).toBe("300px");
    expect(node.style.minHeight).toBe("180px");
    expect(node.getAttribute("aria-label")).toBe("Advertisement");
    await f.manager.dispose();
    expect(f.consent.callbacks.size).toBe(0);
  });
  it("grants advertising independently of analytics", async () => {
    const f = fixture();
    const placement = f.manager.register(baseSlot);
    placement.mount(host());
    f.consent.grant("analytics");
    await flush();
    expect(f.provider.start).not.toHaveBeenCalled();
    f.consent.grant("advertising");
    await flush();
    expect(f.provider.start).toHaveBeenCalledTimes(1);
    expect(f.provider.load).toHaveBeenCalledTimes(1);
    expect(placement.state.peek()).toBe("ready");
    await f.manager.dispose();
  });
  it("requires both advertising and personalization when policy is personalized", async () => {
    const policy: AdPolicyV1 = {
      ...basePolicy, personalized: true, requiredPurposes: ["advertising", "ad-personalization"]
    };
    const slot: AdSlotV1 = {
      ...baseSlot, personalized: true, requiredPurposes: ["advertising", "ad-personalization"]
    };
    const f = fixture(policy);
    const placement = f.manager.register(slot); placement.mount(host());
    f.consent.grant("advertising");
    await flush();
    expect(f.provider.start).not.toHaveBeenCalled();
    f.consent.grant("ad-personalization");
    await flush();
    expect(placement.state.peek()).toBe("ready");
    await f.manager.dispose();
  });
  it("accepts only configured placements, formats, schema and max slots", async () => {
    const f = fixture();
    expect(() => f.manager.register({ ...baseSlot, schema: "other" as AdSlotV1["schema"] })).toThrow();
    expect(() => f.manager.register({ ...baseSlot, placement: "unapproved/path" })).toThrow();
    expect(() => f.manager.register({ ...baseSlot, formats: ["video"] })).toThrow();
    expect(() => f.manager.register({ ...baseSlot, reserve: { minWidth: 0, minHeight: 180 } })).toThrow();
    f.manager.register(baseSlot);
    expect(() => f.manager.register(baseSlot)).toThrow();
    f.manager.register({ ...baseSlot, id: "rail", placement: "home/rail" });
    expect(() => f.manager.register({ ...baseSlot, id: "another" })).toThrow();
    await f.manager.dispose();
  });
  it("fails closed if the capability schema or grant snapshot is invalid", async () => {
    const consent = new ConsentFixture(); consent.grant("advertising");
    const provider = fixture().provider;
    const bad: ConsentCapabilityV1 = {
      schema: "different" as ConsentCapabilityV1["schema"],
      snapshot: () => consent.snapshot(), can: purpose => consent.can(purpose),
      subscribe: listener => consent.subscribe(listener)
    };
    const manager = createAdsManagerV1({ consent: bad, provider, policy: basePolicy, scopeId: "app1" });
    const placement = manager.register(baseSlot); placement.mount(host());
    await flush();
    expect(provider.start).not.toHaveBeenCalled();
    await manager.dispose();
  });
  it("aborts a stale load and calls remove/dispose on revocation", async () => {
    const f = fixture(); f.consent.grant("advertising");
    let finish!: (value: "filled") => void;
    vi.mocked(f.provider.load).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const placement = f.manager.register(baseSlot); placement.mount(host());
    await flush();
    const request = vi.mocked(f.provider.load).mock.calls[0]?.[2];
    expect(request).toBeDefined();
    f.consent.change("advertising", "revoked");
    expect(request!.aborted).toBe(true);
    expect(placement.state.peek()).toBe("revoked");
    finish("filled");
    await flush();
    expect(placement.state.peek()).toBe("revoked");
    await f.manager.dispose();
    expect(f.provider.remove).toHaveBeenCalledWith(baseSlot.id);
    expect(f.provider.dispose).toHaveBeenCalledTimes(1);
  });
  it("can restart a fresh provider after revocation and regrant", async () => {
    const f = fixture(); f.consent.grant("advertising");
    const placement = f.manager.register(baseSlot); placement.mount(host());
    await flush();
    expect(placement.state.peek()).toBe("ready");
    f.consent.change("advertising", "revoked");
    await flush();
    f.consent.grant("advertising");
    await flush();
    expect(f.provider.start).toHaveBeenCalledTimes(2);
    expect(placement.state.peek()).toBe("ready");
    await f.manager.dispose();
  });
  it("does not duplicate active requests when load is called repeatedly", async () => {
    const f = fixture(); f.consent.grant("advertising");
    let finish!: (value: "filled") => void;
    vi.mocked(f.provider.load).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const placement = f.manager.register(baseSlot); placement.mount(host());
    await flush();
    const a = placement.load(), b = placement.load();
    expect(f.provider.load).toHaveBeenCalledTimes(1);
    finish("filled");
    await Promise.all([a, b]); await flush();
    expect(placement.state.peek()).toBe("ready");
    await f.manager.dispose();
  });
  it("requires explicit reviewed provider refresh support and rate-limits refresh", async () => {
    const f = fixture(); f.consent.grant("advertising");
    expect(() => f.manager.register(baseSlot, { refreshMinIntervalMs: 30000 })).toThrow();
    await f.manager.dispose();
    let clock = 1000;
    const consent = new ConsentFixture(); consent.grant("advertising");
    const provider = { version: 1 as const, id: "mock",
      start: vi.fn(async () => undefined), load: vi.fn(async () => "filled" as const),
      refresh: vi.fn(async () => "empty" as const), minRefreshIntervalMs: 60000,
      remove: vi.fn(async () => undefined), dispose: vi.fn(async () => undefined)
    };
    const manager = createAdsManagerV1({ consent, provider, policy: basePolicy, scopeId: "app2", now: () => clock });
    const placement = manager.register(baseSlot, { refreshMinIntervalMs: 30000 });
    placement.mount(host());
    await flush();
    await placement.refresh();
    expect(provider.refresh).not.toHaveBeenCalled();
    clock += 60000;
    await placement.refresh();
    expect(provider.refresh).toHaveBeenCalledTimes(1);
    expect(placement.state.peek()).toBe("empty");
    await manager.dispose();
  });
  it("returns failed on provider exceptions with redacted state", async () => {
    const f = fixture(); f.consent.grant("advertising");
    vi.mocked(f.provider.load).mockRejectedValue(new Error("SENSITIVE_PRIVATE_TOKEN"));
    const placement = f.manager.register(baseSlot); placement.mount(host());
    await flush();
    expect(placement.state.peek()).toBe("failed");
    expect(JSON.stringify(placement.state.peek())).not.toContain("SENSITIVE");
    await f.manager.dispose();
  });
  it("aborts hung provider loads at the policy deadline", async () => {
    vi.useFakeTimers();
    const f = fixture(); f.consent.grant("advertising");
    vi.mocked(f.provider.load).mockImplementation(() => new Promise(() => undefined));
    const placement = f.manager.register(baseSlot); placement.mount(host());
    await flush();
    const request = vi.mocked(f.provider.load).mock.calls[0]?.[2];
    expect(request).toBeDefined();
    await vi.advanceTimersByTimeAsync(250);
    expect(request?.aborted).toBe(true);
    expect(placement.state.peek()).toBe("failed");
    await f.manager.dispose();
  });
  it("owner disposal releases the manager and child placement", async () => {
    const consent = new ConsentFixture(); consent.grant("advertising");
    const provider = fixture().provider;
    const owner = createOwner();
    let placement!: ReturnType<ReturnType<typeof createAdsManagerV1>["register"]>;
    runWithOwner(owner, () => {
      const manager = createAdsManagerV1({ consent, provider, policy: basePolicy, scopeId: "scope" });
      placement = manager.register(baseSlot);
    });
    placement.mount(host());
    await flush();
    disposeOwner(owner);
    await flush();
    expect(placement.state.peek()).toBe("disposed");
    expect(consent.callbacks.size).toBe(0);
  });
  it("keeps app scopes and providers isolated", async () => {
    const a = fixture(), b = fixture();
    a.consent.grant("advertising");
    const one = a.manager.register(baseSlot), two = b.manager.register(baseSlot);
    one.mount(host()); two.mount(host()); await flush();
    expect(one.state.peek()).toBe("ready");
    expect(two.state.peek()).toBe("awaiting-consent");
    await a.manager.dispose(); await b.manager.dispose();
  });
});
