import { createAdsManagerV1 } from "@zaakiyjs/ads";
import type {
  ConsentCapabilityV1, ConsentDecisionV1, ConsentPurposeV1, ConsentSnapshotV1,
  AdProviderV1, AdSlotV1
} from "@zaakiyjs/ads";

const firstElement = document.querySelector<HTMLElement>("#first")!;
const secondElement = document.querySelector<HTMLElement>("#second")!;
const purposes: ConsentPurposeV1[] = [
  "essential", "analytics", "advertising", "ad-personalization", "functional-third-party"
];
const values = new Map<ConsentPurposeV1, ConsentDecisionV1>(
  purposes.map(p => [p, p === "essential" ? "granted" : "unknown"])
);
let revision = 0;
const listeners = new Set<(next: ConsentSnapshotV1, previous: ConsentSnapshotV1) => void>();
const snapshot = (): ConsentSnapshotV1 => ({
  schema: "zaakiy.consent/1", policyId: "browser-test", policyVersion: "1", revision,
  grants: Object.fromEntries(purposes.map(p => [
    p, { purpose: p, decision: values.get(p)! }
  ])) as unknown as ConsentSnapshotV1["grants"]
});
const consent: ConsentCapabilityV1 = {
  schema: "zaakiy.consent/1", snapshot,
  can: p => values.get(p) === "granted",
  subscribe(fn) { listeners.add(fn); return () => { listeners.delete(fn); }; }
};
function change(purpose: ConsentPurposeV1, decision: ConsentDecisionV1): void {
  const before = snapshot();
  values.set(purpose, decision);
  revision++;
  const after = snapshot();
  for (const fn of [...listeners]) fn(after, before);
}
const metrics = { starts: 0, loads: 0, removes: 0, disposes: 0, aborted: 0 };
const provider: AdProviderV1 = {
  version: 1, id: "testProvider",
  async start({ signal }) {
    if (signal.aborted) { metrics.aborted++; throw new Error("aborted"); }
    metrics.starts++;
  },
  async load(_slot, host, signal) {
    metrics.loads++;
    if (signal.aborted) { metrics.aborted++; throw new Error("aborted"); }
    const iframe = document.createElement("iframe");
    iframe.title = "Sponsored content";
    iframe.width = "300";
    iframe.height = "180";
    iframe.setAttribute("data-creative", "test");
    host.appendChild(iframe);
    return "filled";
  },
  remove(slotId) {
    metrics.removes++;
    const node = document.querySelector<HTMLElement>('[data-zaakiy-ad-slot="' + slotId + '"]');
    node?.querySelector("iframe")?.remove();
  },
  dispose() { metrics.disposes++; }
};
const manager = createAdsManagerV1({
  consent, provider, scopeId: "browser1",
  policy: {
    version: 1, providerId: provider.id, allowPlacements: ["first/display", "second/display"],
    requiredPurposes: ["advertising"], personalized: false, maxSlots: 2, loadTimeoutMs: 5000
  }
});
const makeSlot = (id: string, placement: string): AdSlotV1 => ({
  schema: "zaakiy.ads/1", id, placement, formats: ["display"],
  dimensions: [{ width: 300, height: 180 }],
  reserve: { minWidth: 300, minHeight: 180 },
  requiredPurposes: ["advertising"], personalized: false
});
const first = manager.register(makeSlot("first", "first/display"));
const second = manager.register(makeSlot("second", "second/display"), { lazy: true });
first.mount(firstElement);
second.mount(secondElement);
const initialPosition = document.querySelector("#after")!.getBoundingClientRect().top;
const layoutShifts: number[] = [];
if (typeof PerformanceObserver !== "undefined") {
  try {
    const observer = new PerformanceObserver(entries => {
      for (const entry of entries.getEntries()) {
        const record = entry as PerformanceEntry & { value?: number; hadRecentInput?: boolean };
        if (!record.hadRecentInput && typeof record.value === "number") layoutShifts.push(record.value);
      }
    });
    observer.observe({ type: "layout-shift", buffered: false });
  } catch { /* engines without layout-shift performance entry */ }
}
const app = {
  metrics,
  state: () => first.state.peek(),
  lazyState: () => second.state.peek(),
  initialIsSame: () => firstElement === document.querySelector("#first"),
  initialPosition,
  afterPosition: () => document.querySelector("#after")!.getBoundingClientRect().top,
  layoutShifts,
  subscriptions: () => listeners.size,
  grantAds: () => change("advertising", "granted"),
  denyAds: () => change("advertising", "denied"),
  revokeAds: () => change("advertising", "revoked"),
  grantAnalytics: () => change("analytics", "granted"),
  grantPersonalization: () => change("ad-personalization", "granted"),
  async dispose() { await manager.dispose(); }
};
Object.assign(window, { __ads: app });
