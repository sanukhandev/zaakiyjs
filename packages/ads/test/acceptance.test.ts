// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createOwner, disposeOwner, runWithOwner } from "@zaakiyjs/core";
import { bindAdsToRoutes, createAdsManager, renderAdSlotPlaceholder } from "../src/index.js";
import type { AdProvider, AdsConsentGate, AdSlotConfig, ConsentDecision } from "../src/index.js";

const config: AdSlotConfig = {
  id: "advertisement", providerId: "mock", placement: "layout/top",
  format: "banner", mode: "nonpersonalized", minHeight: 180
};
function setup(initial: ConsentDecision = "granted") {
  let decision = initial;
  const listeners = new Set<() => void>();
  const gate: AdsConsentGate = {
    check: () => decision,
    subscribe: fn => { listeners.add(fn); return () => { listeners.delete(fn); }; }
  };
  const provider: AdProvider = {
    id: "mock", requiredPurposes: ["advertising"], supportsRefresh: true,
    initialize: vi.fn(async () => undefined),
    load: vi.fn(async () => ({ status: "filled" as const })),
    refresh: vi.fn(async () => ({ status: "filled" as const })),
    unmount: vi.fn(), dispose: vi.fn()
  };
  return { gate, provider, listeners, change(value: ConsentDecision) {
    decision = value; for (const fn of [...listeners]) fn();
  } };
}
async function flush() { for (let i = 0; i < 10; i++) await Promise.resolve(); }
afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });

describe("ads acceptance regressions", () => {
  it("binds manager and slot cleanup to their Core owner", async () => {
    const f = setup();
    const owner = createOwner();
    let slot: ReturnType<ReturnType<typeof createAdsManager>["registerSlot"]> | undefined;
    runWithOwner(owner, () => {
      const manager = createAdsManager({ consent: f.gate, providers: [f.provider] });
      slot = manager.registerSlot(config);
    });
    slot!.mount(document.createElement("div"));
    await flush();
    disposeOwner(owner);
    expect(slot!.state.peek().phase).toBe("disposed");
    expect(f.listeners.size).toBe(0);
    expect(f.provider.dispose).toHaveBeenCalled();
  });
  it("uses ResizeObserver measurements without a synchronous clientWidth read", async () => {
    const original = globalThis.ResizeObserver;
    let report!: (entries: ResizeObserverEntry[]) => void;
    const disconnect = vi.fn();
    class Observer {
      constructor(fn: ResizeObserverCallback) { report = entries => fn(entries, this as unknown as ResizeObserver); }
      observe(): void {}
      disconnect = disconnect;
      unobserve(): void {}
    }
    globalThis.ResizeObserver = Observer as unknown as typeof ResizeObserver;
    try {
      const f = setup("unknown");
      const manager = createAdsManager({ consent: f.gate, providers: [f.provider] });
      const slot = manager.registerSlot({
        ...config, responsive: [
          { minWidth: 0, size: { width: 300, height: 250 } },
          { minWidth: 600, size: { width: 728, height: 90 } }
        ]
      });
      const element = document.createElement("div");
      Object.defineProperty(element, "clientWidth", { get: () => { throw new Error("Forced layout"); } });
      slot.mount(element);
      report([{ target: element, contentRect: { width: 800 } } as ResizeObserverEntry]);
      f.change("granted");
      await flush();
      expect(f.provider.load).toHaveBeenCalledWith(expect.objectContaining({ dimensions: { width: 728, height: 90 } }));
      slot.dispose();
      expect(disconnect).toHaveBeenCalled();
      manager.dispose();
    } finally { globalThis.ResizeObserver = original; }
  });
  it("does not refresh when the page is hidden", async () => {
    const f = setup();
    let clock = 100000;
    const manager = createAdsManager({ consent: f.gate, providers: [f.provider], now: () => clock, document });
    const slot = manager.registerSlot({ ...config, refresh: { enabled: true, minIntervalMs: 30000 } });
    slot.mount(document.createElement("div"));
    await flush();
    clock += 120000;
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    try {
      expect(await slot.refresh()).toBe(false);
      expect(f.provider.refresh).not.toHaveBeenCalled();
    } finally { delete (document as { visibilityState?: string }).visibilityState; manager.dispose(); }
  });
  it("cancels an active load on pause and resumes without accepting a stale result", async () => {
    const f = setup();
    const resolvers: Array<(v: { status: "filled" }) => void> = [];
    vi.mocked(f.provider.load).mockImplementation(() => new Promise(resolve => resolvers.push(resolve)));
    const manager = createAdsManager({ consent: f.gate, providers: [f.provider] });
    const slot = manager.registerSlot(config);
    slot.mount(document.createElement("div"));
    await flush();
    expect(resolvers).toHaveLength(1);
    slot.pause();
    expect(slot.state.peek().phase).toBe("registered");
    slot.resume();
    await flush();
    expect(resolvers).toHaveLength(2);
    resolvers[0]!({ status: "filled" });
    await flush();
    expect(slot.state.peek().phase).toBe("loading");
    resolvers[1]!({ status: "filled" });
    await flush();
    expect(slot.state.peek().phase).toBe("filled");
    manager.dispose();
  });
  it("normalizes provider initialization errors without leaking raw messages", async () => {
    const f = setup();
    vi.mocked(f.provider.initialize).mockRejectedValue(new Error("apikey=SECRET123"));
    const manager = createAdsManager({ consent: f.gate, providers: [f.provider] });
    const slot = manager.registerSlot(config);
    slot.mount(document.createElement("div"));
    await flush();
    expect(slot.state.peek()).toEqual({ phase: "failed", errorCode: "provider-error" });
    expect(JSON.stringify(slot.state.peek())).not.toContain("SECRET123");
    expect(f.provider.load).not.toHaveBeenCalled();
    manager.dispose();
  });
  it("hydrates an SSR placeholder into the exact existing DOM node", async () => {
    const f = setup("unknown");
    const host = document.createElement("main");
    host.innerHTML = renderAdSlotPlaceholder(config);
    document.body.appendChild(host);
    const element = host.firstElementChild as HTMLElement;
    const manager = createAdsManager({ consent: f.gate, providers: [f.provider] });
    const slot = manager.registerSlot(config);
    slot.mount(element);
    f.change("granted");
    await flush();
    expect(host.firstElementChild).toBe(element);
    expect(element.style.minHeight).toBe("180px");
    expect(slot.state.peek().phase).toBe("filled");
    manager.dispose();
  });
  it("deduplicates route registrations and releases stale page slots on navigation", () => {
    const f = setup("unknown");
    const manager = createAdsManager({ consent: f.gate, providers: [f.provider] });
    let callback!: (route: string) => void;
    let route = "/home";
    const adapter = bindAdsToRoutes(manager, {
      currentRouteId: () => route,
      subscribe: fn => { callback = fn; return () => undefined; }
    });
    const first = adapter.register({ ...config, routeId: "/home" });
    expect(adapter.register({ ...config, routeId: "/home" })).toBe(first);
    callback("/home");
    expect(first.state.peek().phase).toBe("registered");
    route = "/next"; callback(route);
    expect(first.state.peek().phase).toBe("disposed");
    const second = adapter.register({ ...config, routeId: "/next" });
    expect(second).not.toBe(first);
    adapter.dispose(); manager.dispose();
  });
  it("cancels an in-flight refresh on slot disposal", async () => {
    const f = setup();
    let now = 0;
    let complete!: (v: { status: "filled" }) => void;
    vi.mocked(f.provider.refresh).mockImplementation(() => new Promise(resolve => { complete = resolve; }));
    const manager = createAdsManager({ consent: f.gate, providers: [f.provider], now: () => now });
    const slot = manager.registerSlot({ ...config, refresh: { enabled: true, minIntervalMs: 30000 } });
    slot.mount(document.createElement("div"));
    await flush();
    now = 60000;
    const attempt = slot.refresh();
    await flush();
    const request = vi.mocked(f.provider.refresh).mock.calls[0]?.[0];
    expect(request).toBeDefined();
    slot.dispose();
    expect(request?.signal.aborted).toBe(true);
    complete({ status: "filled" });
    expect(await attempt).toBe(false);
    expect(slot.state.peek().phase).toBe("disposed");
    manager.dispose();
  });
  it("rejects registrations after manager disposal", () => {
    const f = setup();
    const manager = createAdsManager({ consent: f.gate, providers: [f.provider] });
    manager.dispose();
    expect(() => manager.registerSlot(config)).toThrow();
    expect(() => manager.registerProvider(f.provider)).toThrow();
  });
});
