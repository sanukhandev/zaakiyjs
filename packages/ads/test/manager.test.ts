// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAdsManager, bindAdsToRoutes, renderAdSlotPlaceholder } from "../src/index.js";
import type { AdsConsentGate, AdProvider, AdSlotConfig, ConsentDecision } from "../src/index.js";

class Gate implements AdsConsentGate {
  value: ConsentDecision = "unknown";
  seen: readonly string[] = [];
  listeners = new Set<() => void>();
  check(purposes: readonly string[]): ConsentDecision { this.seen = purposes; return this.value; }
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }
  change(value: ConsentDecision): void {
    this.value = value;
    for (const listener of [...this.listeners]) listener();
  }
}
const base: AdSlotConfig = {
  id: "dashboard-banner", providerId: "mock", placement: "dashboard/top",
  format: "banner", mode: "nonpersonalized", minHeight: 180, size: { width: 320, height: 180 }
};
function fixture() {
  const gate = new Gate();
  const provider: AdProvider = {
    id: "mock", requiredPurposes: ["ads"], supportsRefresh: true,
    reinitializeAfterRevocation: true, minRefreshIntervalMs: 60000,
    initialize: vi.fn(async () => undefined),
    load: vi.fn(async () => ({ status: "filled" as const })),
    refresh: vi.fn(async () => ({ status: "empty" as const })),
    unmount: vi.fn(),
    dispose: vi.fn()
  };
  return { gate, provider };
}
async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}
afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });

describe("ads manager and consent", () => {
  it("creates an inert manager, with no provider initialization before authorization", async () => {
    const { gate, provider } = fixture();
    const manager = createAdsManager({ consent: gate, providers: [provider] });
    const slot = manager.registerSlot(base);
    expect(slot.state.peek().phase).toBe("registered");
    const node = document.createElement("div");
    slot.mount(node);
    await settle();
    expect(slot.state.peek().phase).toBe("waiting-consent");
    expect(provider.initialize).not.toHaveBeenCalled();
    expect(provider.load).not.toHaveBeenCalled();
    expect(gate.seen).toEqual(["ads"]);
    expect(document.querySelectorAll("script")).toHaveLength(0);
    manager.dispose();
    expect(gate.listeners.size).toBe(0);
  });
  it("denial blocks nonpersonalized placements as well", () => {
    const { gate, provider } = fixture();
    gate.change("denied");
    const manager = createAdsManager({ consent: gate, providers: [provider] });
    const slot = manager.registerSlot(base);
    slot.mount(document.createElement("div"));
    expect(slot.state.peek().phase).toBe("blocked");
    expect(provider.initialize).not.toHaveBeenCalled();
    manager.dispose();
  });
  it("authorizes, initializes once and reports provider-confirmed fill", async () => {
    const { gate, provider } = fixture();
    const events: string[] = [];
    const manager = createAdsManager({ consent: gate, providers: [provider], onEvent: e => events.push(e.type) });
    const first = manager.registerSlot(base);
    const second = manager.registerSlot({ ...base, id: "sidebar" });
    const el = document.createElement("div");
    first.mount(el);
    second.mount(document.createElement("div"));
    gate.change("granted");
    await settle();
    expect(provider.initialize).toHaveBeenCalledTimes(1);
    expect(provider.load).toHaveBeenCalledTimes(2);
    expect(first.state.peek().phase).toBe("filled");
    expect(second.state.peek().phase).toBe("filled");
    expect(events).toContain("filled");
    expect(events).not.toContain("impression-confirmed");
    expect(el.getAttribute("aria-label")).toBe("Advertisement");
    expect(el.style.minHeight).toBe("180px");
    manager.dispose();
  });
  it("tracks distinct no-fill, blocked and failed outcomes", async () => {
    const { gate, provider } = fixture();
    gate.change("granted");
    vi.mocked(provider.load).mockResolvedValueOnce({ status: "empty" });
    vi.mocked(provider.load).mockResolvedValueOnce({ status: "blocked" });
    vi.mocked(provider.load).mockRejectedValueOnce(new Error("PRIVATE_UNSAFE_VENDOR_ERROR"));
    const manager = createAdsManager({ consent: gate, providers: [provider] });
    const slots = ["empty", "blocked", "failed"].map(id => {
      const slot = manager.registerSlot({ ...base, id });
      slot.mount(document.createElement("div"));
      return slot;
    });
    await settle();
    expect(slots.map(slot => slot.state.peek().phase)).toEqual(["empty", "blocked", "failed"]);
    expect(slots[2]?.state.peek().errorCode).toBe("provider-error");
    expect(JSON.stringify(slots[2]?.state.peek())).not.toContain("PRIVATE");
    manager.dispose();
  });
  it("rejects unknown providers, invalid IDs, duplicate slots and duplicate providers", () => {
    const { gate, provider } = fixture();
    const manager = createAdsManager({ consent: gate, providers: [provider] });
    expect(() => manager.registerProvider(provider)).toThrow();
    expect(() => manager.registerSlot({ ...base, providerId: "not-registered" })).toThrow();
    expect(() => manager.registerSlot({ ...base, id: "<script>" })).toThrow();
    expect(() => manager.registerSlot({ ...base, minHeight: 0 })).toThrow();
    expect(() => manager.registerSlot({ ...base, responsive: [{ minWidth: 100, size: { width: 300, height: 50 } }, { minWidth: 100, size: { width: 500, height: 50 } }] })).toThrow();
    manager.registerSlot(base);
    expect(() => manager.registerSlot(base)).toThrow();
    manager.dispose();
  });
  it("aborts a stale in-flight load on revocation and does not report filled", async () => {
    const { gate, provider } = fixture();
    gate.change("granted");
    let finish!: (value: { status: "filled" }) => void;
    vi.mocked(provider.load).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const manager = createAdsManager({ consent: gate, providers: [provider] });
    const slot = manager.registerSlot(base);
    slot.mount(document.createElement("div"));
    await settle();
    expect(slot.state.peek().phase).toBe("loading");
    const request = vi.mocked(provider.load).mock.calls[0]?.[0];
    gate.change("denied");
    expect(request?.signal.aborted).toBe(true);
    finish({ status: "filled" });
    await settle();
    expect(slot.state.peek().phase).toBe("blocked");
    expect(provider.dispose).toHaveBeenCalled();
    manager.dispose();
  });
  it("rejects mixed personalization modes for one provider", () => {
    const { gate, provider } = fixture();
    const manager = createAdsManager({ consent: gate, providers: [provider] });
    manager.registerSlot(base);
    expect(() => manager.registerSlot({ ...base, id: "personalized", mode: "personalized" })).toThrow();
    manager.dispose();
  });
  it("does not initialize a provider when consent revokes before the microtask", async () => {
    const { gate, provider } = fixture(); gate.change("granted");
    const manager = createAdsManager({ consent: gate, providers: [provider] });
    const slot = manager.registerSlot(base);
    slot.mount(document.createElement("div"));
    gate.change("denied");
    await settle();
    expect(provider.initialize).not.toHaveBeenCalled();
    expect(slot.state.peek().phase).toBe("blocked");
    manager.dispose();
  });
  it("prevents unsafe provider reinitialization after revocation", async () => {
    const { gate, provider } = fixture();
    gate.change("granted");
    const unsafe = { ...provider, reinitializeAfterRevocation: false };
    const manager = createAdsManager({ consent: gate, providers: [unsafe] });
    const slot = manager.registerSlot(base);
    slot.mount(document.createElement("div"));
    await settle();
    gate.change("denied");
    gate.change("granted");
    await settle();
    expect(slot.state.peek().phase).toBe("blocked");
    expect(unsafe.initialize).toHaveBeenCalledTimes(1);
    manager.dispose();
  });
  it("emits impressions only when confirmed by a provider", async () => {
    const { gate, provider } = fixture(); gate.change("granted");
    vi.mocked(provider.load).mockResolvedValue({ status: "filled", impressionConfirmed: true });
    const events: string[] = [];
    const manager = createAdsManager({ consent: gate, providers: [provider], onEvent: e => events.push(e.type) });
    const slot = manager.registerSlot(base);
    slot.mount(document.createElement("div"));
    await settle();
    expect(events).toContain("impression-confirmed");
    manager.dispose();
  });
  it("does not share app state, consent, providers or slots", async () => {
    const a = fixture(), b = fixture();
    a.gate.change("granted");
    const first = createAdsManager({ consent: a.gate, providers: [a.provider] });
    const second = createAdsManager({ consent: b.gate, providers: [b.provider] });
    const one = first.registerSlot(base), two = second.registerSlot(base);
    one.mount(document.createElement("div")); two.mount(document.createElement("div"));
    await settle();
    expect(one.state.peek().phase).toBe("filled");
    expect(two.state.peek().phase).toBe("waiting-consent");
    first.dispose(); second.dispose();
  });
  it("releases provider slots, observers and subscriptions on disposal", async () => {
    const { gate, provider } = fixture();
    gate.change("granted");
    const manager = createAdsManager({ consent: gate, providers: [provider] });
    const slot = manager.registerSlot(base), node = document.createElement("div");
    slot.mount(node);
    await settle();
    slot.dispose(); slot.dispose();
    expect(provider.unmount).toHaveBeenCalledTimes(1);
    expect(slot.state.peek().phase).toBe("disposed");
    expect(manager.getSlot(base.id)).toBeUndefined();
    manager.dispose(); manager.dispose();
    expect(gate.listeners.size).toBe(0);
    expect(provider.dispose).toHaveBeenCalledTimes(1);
  });
});

describe("lazy slots, refresh and route lifetime", () => {
  it("does not load a lazy slot until visible", async () => {
    const previous = globalThis.IntersectionObserver;
    let triggered!: (entries: IntersectionObserverEntry[]) => void;
    const disconnect = vi.fn();
    class IO {
      constructor(callback: IntersectionObserverCallback) { triggered = entries => callback(entries, this as unknown as IntersectionObserver); }
      observe(): void {}
      disconnect = disconnect;
      unobserve(): void {}
      takeRecords(): IntersectionObserverEntry[] { return []; }
      readonly root = null; readonly rootMargin = "200px"; readonly thresholds = [0];
    }
    globalThis.IntersectionObserver = IO as unknown as typeof IntersectionObserver;
    try {
      const { gate, provider } = fixture();
      gate.change("granted");
      const manager = createAdsManager({ consent: gate, providers: [provider] });
      const slot = manager.registerSlot({ ...base, lazy: true });
      const element = document.createElement("div");
      slot.mount(element);
      await settle();
      expect(slot.state.peek().phase).toBe("waiting-visibility");
      expect(provider.load).not.toHaveBeenCalled();
      triggered([{ target: element, isIntersecting: true } as IntersectionObserverEntry]);
      await settle();
      expect(slot.state.peek().phase).toBe("filled");
      slot.dispose();
      expect(disconnect).toHaveBeenCalledTimes(1);
      manager.dispose();
    } finally { globalThis.IntersectionObserver = previous; }
  });
  it("enforces declared refresh capability, min interval and active document", async () => {
    const { gate, provider } = fixture(); gate.change("granted");
    let time = 1_000_000;
    const manager = createAdsManager({ consent: gate, providers: [provider], now: () => time });
    const slot = manager.registerSlot({ ...base, refresh: { enabled: true, minIntervalMs: 30000 } });
    slot.mount(document.createElement("div"));
    await settle();
    expect(await slot.refresh()).toBe(false);
    time += 60_000;
    expect(await slot.refresh()).toBe(true);
    expect(slot.state.peek().phase).toBe("empty");
    expect(provider.refresh).toHaveBeenCalledTimes(1);
    manager.dispose();
  });
  it("does not permit refresh before a completed initial slot request", async () => {
    const { gate, provider } = fixture(); gate.change("granted");
    const manager = createAdsManager({ consent: gate, providers: [provider] });
    const slot = manager.registerSlot({ ...base, refresh: { enabled: true, minIntervalMs: 30000 } });
    expect(await slot.refresh()).toBe(false);
    slot.mount(document.createElement("div"));
    expect(await slot.refresh()).toBe(false);
    await settle();
    expect(provider.refresh).not.toHaveBeenCalled();
    manager.dispose();
  });
  it("does not repeat a filled load through load() to bypass refresh policy", async () => {
    const { gate, provider } = fixture(); gate.change("granted");
    const manager = createAdsManager({ consent: gate, providers: [provider] });
    const slot = manager.registerSlot(base);
    slot.mount(document.createElement("div"));
    await settle();
    await slot.load(); await slot.load();
    expect(provider.load).toHaveBeenCalledTimes(1);
    manager.dispose();
  });
  it("does not implicitly refresh a slot without a declared policy", async () => {
    const { gate, provider } = fixture(); gate.change("granted");
    const manager = createAdsManager({ consent: gate, providers: [provider] });
    const slot = manager.registerSlot(base);
    slot.mount(document.createElement("div"));
    await settle();
    expect(await slot.refresh()).toBe(false);
    manager.dispose();
  });
  it("route changes dispose stale slots but preserve explicit persistent shell slots", () => {
    const { gate, provider } = fixture();
    const manager = createAdsManager({ consent: gate, providers: [provider] });
    let callback!: (route: string) => void;
    let active = "/home";
    const unsubscribe = vi.fn();
    const adapter = bindAdsToRoutes(manager, {
      currentRouteId: () => active,
      subscribe: cb => { callback = cb; return unsubscribe; }
    });
    const transient = adapter.register({ ...base, routeId: "/home" });
    const persistent = adapter.register({ ...base, id: "shell", persistent: true });
    active = "/about"; callback(active);
    expect(transient.state.peek().phase).toBe("disposed");
    expect(persistent.state.peek().phase).not.toBe("disposed");
    expect(() => adapter.register({ ...base, id: "other", routeId: "/disabled" })).toThrow();
    adapter.dispose();
    expect(persistent.state.peek().phase).toBe("disposed");
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    manager.dispose();
  });
  it("renders a safe SSR placeholder with stable reserved dimensions", () => {
    const html = renderAdSlotPlaceholder({ id: base.id, minHeight: 180, label: 'Ad "preview" <unsafe>' });
    expect(html).toContain('data-zaakiy-ad-slot="dashboard-banner"');
    expect(html).toContain("min-height:180px");
    expect(html).toContain("&lt;unsafe&gt;");
    expect(html).not.toContain("<unsafe>");
    expect(() => renderAdSlotPlaceholder({ id: "x", minHeight: -1 })).toThrow();
    expect(() => renderAdSlotPlaceholder({ id: 'evil" onclick=', minHeight: 80 })).toThrow();
  });
});
