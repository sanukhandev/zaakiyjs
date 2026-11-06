import { getOwner, onCleanup } from "@zaakiyjs/core";
import { signal } from "@zaakiyjs/signals";
import type {
  AdMountedPlacementV1, AdPlacementOptionsV1, AdPolicyV1, AdProviderV1,
  AdProviderWithRefreshV1, AdsManagerOptionsV1, AdsManagerV1,
  AdSlotStateV1, AdSlotV1, AdvertisingPurposeV1,
  ConsentCapabilityV1, ConsentDecisionV1, ConsentSnapshotV1
} from "./contract-v1.js";

const ID = /^[A-Za-z][A-Za-z0-9_-]{0,127}$/;
const ALL_PURPOSES = ["essential", "analytics", "advertising", "ad-personalization", "functional-third-party"] as const;
const DECISIONS = new Set<ConsentDecisionV1>(["unknown", "granted", "denied", "revoked"]);
const AD_PURPOSES = new Set<AdvertisingPurposeV1>(["advertising", "ad-personalization"]);

function positive(value: number, bound = 4096): boolean {
  return Number.isSafeInteger(value) && value > 0 && value <= bound;
}
function validatePolicy(policy: AdPolicyV1, provider: AdProviderV1, scopeId: string): void {
  if (policy.version !== 1 || provider.version !== 1 || !ID.test(provider.id) ||
      policy.providerId !== provider.id || !ID.test(scopeId) ||
      !positive(policy.maxSlots, 1000) || !positive(policy.loadTimeoutMs, 120000) ||
      !Array.isArray(policy.allowPlacements) || policy.allowPlacements.length === 0 ||
      policy.allowPlacements.some(p => typeof p !== "string" || !p.trim() || p.length > 256) ||
      policy.requiredPurposes.some(p => !AD_PURPOSES.has(p))) {
    throw new TypeError("Invalid advertising provider policy");
  }
  if (policy.personalized && (!policy.requiredPurposes.includes("advertising") ||
      !policy.requiredPurposes.includes("ad-personalization"))) {
    throw new TypeError("Personalization requires both consent purposes");
  }
}
function validateSlot(slot: AdSlotV1, policy: AdPolicyV1): void {
  if (slot.schema !== "zaakiy.ads/1" || !ID.test(slot.id) ||
      !policy.allowPlacements.includes(slot.placement) || slot.personalized !== policy.personalized ||
      !Array.isArray(slot.formats) || slot.formats.length !== 1 || slot.formats[0] !== "display" ||
      !Array.isArray(slot.dimensions) || !slot.dimensions.length ||
      slot.dimensions.some(size => !positive(size.width) || !positive(size.height)) ||
      !positive(slot.reserve.minHeight) || !positive(slot.reserve.minWidth) ||
      (slot.reserve.aspectRatio !== undefined &&
        (!Number.isFinite(slot.reserve.aspectRatio) || slot.reserve.aspectRatio <= 0 || slot.reserve.aspectRatio > 20)) ||
      slot.requiredPurposes.some(p => !AD_PURPOSES.has(p))) {
    throw new TypeError("Invalid or unsupported advertisement slot");
  }
  // Native/video ad networks and autoplay requirements are deliberately unsupported.
  if (slot.personalized && (!slot.requiredPurposes.includes("advertising") ||
      !slot.requiredPurposes.includes("ad-personalization"))) {
    throw new TypeError("Personalized slots must declare both required purposes");
  }
}
function consentSnapshotIsValid(s: ConsentSnapshotV1): boolean {
  if (!s || s.schema !== "zaakiy.consent/1" || !Number.isSafeInteger(s.revision) ||
      s.revision < 0 || typeof s.policyId !== "string" || !s.policyId.trim() ||
      typeof s.policyVersion !== "string" || !s.policyVersion.trim() || !s.grants) return false;
  return ALL_PURPOSES.every(p => s.grants[p]?.purpose === p && DECISIONS.has(s.grants[p].decision));
}
function granted(consent: ConsentCapabilityV1, purposes: readonly AdvertisingPurposeV1[], seen: { revision: number }): boolean {
  try {
    if (consent.schema !== "zaakiy.consent/1") return false;
    const snapshot = consent.snapshot();
    if (!consentSnapshotIsValid(snapshot) || snapshot.revision < seen.revision) return false;
    seen.revision = snapshot.revision;
    return purposes.every(p => snapshot.grants[p].decision === "granted" && consent.can(p) === true);
  } catch { return false; }
}
function hasRefresh(provider: AdProviderV1): provider is AdProviderWithRefreshV1 {
  const p = provider as Partial<AdProviderWithRefreshV1>;
  return typeof p.refresh === "function" && typeof p.minRefreshIntervalMs === "number" && positive(p.minRefreshIntervalMs, 3600000) &&
    p.minRefreshIntervalMs >= 30000;
}
function boundedOptions(opts: AdPlacementOptionsV1): void {
  if (opts.preloadMarginPx !== undefined &&
      (!Number.isSafeInteger(opts.preloadMarginPx) || opts.preloadMarginPx < 0 || opts.preloadMarginPx > 4000)) {
    throw new TypeError("Invalid preload distance");
  }
  if (opts.label !== undefined && (typeof opts.label !== "string" || opts.label.length > 160)) {
    throw new TypeError("Invalid advertisement label");
  }
  if (opts.refreshMinIntervalMs !== undefined &&
      (!positive(opts.refreshMinIntervalMs, 3600000) || opts.refreshMinIntervalMs < 30000)) {
    throw new TypeError("Invalid ad refresh policy");
  }
}
async function bounded<T>(task: Promise<T>, controller: AbortController, limit: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  const stopped = new Promise<never>((_, reject) => {
    onAbort = () => reject(new Error("Advertisement task aborted"));
    controller.signal.addEventListener("abort", onAbort, { once: true });
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error("Advertisement task timed out"));
    }, limit);
    if (controller.signal.aborted) onAbort();
  });
  try { return await Promise.race([task, stopped]); }
  finally {
    if (timer) clearTimeout(timer);
    if (onAbort) controller.signal.removeEventListener("abort", onAbort);
  }
}

/** Canonical P3-00 contract-aligned manager. The older draft API remains temporarily for existing internal fixtures. */
export function createAdsManagerV1(options: AdsManagerOptionsV1): AdsManagerV1 {
  validatePolicy(options.policy, options.provider, options.scopeId);
  const { provider, policy, consent } = options;
  const now = options.now ?? Date.now;
  const doc = options.document ?? (typeof document !== "undefined" ? document : undefined);
  const placements = new Map<string, AdMountedPlacementV1 & { updatePermission(): void }>();
  const slots = new Map<string, AdSlotV1>();
  const resources = new Set<string>();
  const consentRevision = { revision: -1 };
  let disposed = false;
  let providerReady = false;
  let providerAbort: AbortController | undefined;
  let starting: Promise<boolean> | undefined;
  let providerGeneration = 0;
  let retirePromise: Promise<void> = Promise.resolve();
  let nextProviderRequired = false;
  const emit = (type: Parameters<NonNullable<typeof options.onEvent>>[0]["type"], slotId: string): void => {
    try { options.onEvent?.({ type, slotId }); } catch { /* diagnostics never affect slots */ }
  };
  const authorized = (slot: AdSlotV1): boolean => {
    const required = [...new Set<AdvertisingPurposeV1>([
      "advertising",
      ...policy.requiredPurposes,
      ...slot.requiredPurposes,
      ...(policy.personalized || slot.personalized ? ["ad-personalization" as const] : [])
    ])];
    return granted(consent, required, consentRevision);
  };
  const gatePermitsStart = (): boolean =>
    granted(consent, [...new Set<AdvertisingPurposeV1>([
      "advertising", ...policy.requiredPurposes,
      ...(policy.personalized ? ["ad-personalization" as const] : [])
    ])], consentRevision);
  const forgetResource = async (id: string): Promise<void> => {
    if (!resources.delete(id)) return;
    try { await provider.remove(id); } catch { /* provider-side cleanup is best effort */ }
  };
  const retireProvider = (): void => {
    providerGeneration++;
    providerAbort?.abort();
    providerAbort = undefined;
    starting = undefined;
    const wasActive = nextProviderRequired || providerReady;
    nextProviderRequired = false;
    providerReady = false;
    if (!wasActive && resources.size === 0) return;
    const owned = [...resources];
    resources.clear();
    retirePromise = retirePromise.then(async () => {
      for (const id of owned) {
        try { await provider.remove(id); } catch { /* recorded only as redacted diagnostics */ }
      }
      try { await provider.dispose(); } catch { /* teardown must still complete */ }
    });
  };
  const ensureStarted = async (): Promise<boolean> => {
    if (disposed || !gatePermitsStart()) return false;
    if (providerReady) return true;
    if (starting) return starting;
    const generation = providerGeneration;
    const abort = new AbortController();
    providerAbort = abort;
    nextProviderRequired = true;
    const task = (async () => {
      await retirePromise;
      if (disposed || abort.signal.aborted || generation !== providerGeneration || !gatePermitsStart()) return false;
      // Provider.start must honor AbortSignal. Its own async side effects are not trusted after cancellation.
      try {
        await bounded(Promise.resolve().then(() => {
          if (disposed || abort.signal.aborted || generation !== providerGeneration || !gatePermitsStart()) {
            throw new Error("Advertising provider start no longer authorized");
          }
          return provider.start({ signal: abort.signal, scopeId: options.scopeId });
        }),
          abort, policy.loadTimeoutMs);
        if (disposed || abort.signal.aborted || generation !== providerGeneration || !gatePermitsStart()) return false;
        providerReady = true;
        return true;
      } catch { return false; }
    })();
    starting = task;
    void task.then(() => { if (starting === task) starting = undefined; });
    return task;
  };
  const register = (slot: AdSlotV1, opts: AdPlacementOptionsV1 = {}): AdMountedPlacementV1 => {
    if (disposed) throw new Error("Advertising manager disposed");
    validateSlot(slot, policy);
    boundedOptions(opts);
    if (slots.has(slot.id)) throw new TypeError("Duplicate advertising slot ID");
    if (slots.size >= policy.maxSlots) throw new RangeError("Advertising placement limit reached");
    if (opts.refreshMinIntervalMs !== undefined && !hasRefresh(provider)) {
      throw new TypeError("Provider has no approved refresh capability");
    }
    const state = signal<AdSlotStateV1>("idle");
    let element: HTMLElement | undefined;
    let observer: IntersectionObserver | undefined;
    let visible = !opts.lazy;
    let paused = false;
    let ended = false;
    let initiated = false;
    let requestCounter = 0;
    let requestAbort: AbortController | undefined;
    let inFlight: Promise<void> | undefined;
    let lastLoadAt = -Infinity;
    let failures = 0;
    let lastFailureAt = -Infinity;
    const move = (phase: AdSlotStateV1): void => { if (!ended) state.value = phase; };
    const cancel = (): void => {
      requestCounter++;
      requestAbort?.abort();
      requestAbort = undefined;
    };
    const draw = async (refresh: boolean): Promise<void> => {
      if (ended || disposed || paused || !element || !visible || !authorized(slot)) return;
      if (inFlight) return inFlight;
      if (!refresh && state.peek() === "failed" && now() - lastFailureAt <
          Math.min(30000 * Math.pow(2, Math.min(Math.max(failures - 1, 0), 3)), 240000)) return;
      if (refresh) {
        if (!opts.refreshMinIntervalMs || !hasRefresh(provider) || state.peek() !== "ready" && state.peek() !== "empty" ||
            (doc && doc.visibilityState === "hidden")) return;
        if (now() - lastLoadAt < Math.max(opts.refreshMinIntervalMs, provider.minRefreshIntervalMs)) return;
      } else if (state.peek() === "ready" || state.peek() === "empty") return;
      const token = ++requestCounter;
      const controller = new AbortController();
      requestAbort = controller;
      const host = element;
      initiated = true;
      move("loading");
      emit("requested", slot.id);
      const task = (async () => {
        try {
          const started = await ensureStarted();
          if (!started) throw new Error("Provider start failed");
          if (ended || disposed || paused || requestCounter !== token || controller.signal.aborted || !authorized(slot)) return;
          lastLoadAt = now();
          resources.add(slot.id); // provider can insert a partially-rendered creative before resolving
          const invocation = refresh && hasRefresh(provider)
            ? provider.refresh(slot, host, controller.signal)
            : provider.load(slot, host, controller.signal);
          const result = await bounded(Promise.resolve(invocation), controller, policy.loadTimeoutMs);
          if (ended || disposed || requestCounter !== token || controller.signal.aborted || !authorized(slot)) return;
          failures = 0;
          if (result === "filled") { move("ready"); emit("ready", slot.id); }
          else if (result === "empty") { move("empty"); emit("empty", slot.id); }
          else if (result === "blocked") { move("blocked"); emit("blocked", slot.id); }
          else throw new TypeError("Invalid provider result");
          if (refresh) emit("refreshed", slot.id);
        } catch {
          if (!ended && !disposed && requestCounter === token && !controller.signal.aborted) {
            failures++; lastFailureAt = now();
            move("failed");
            emit("failed", slot.id);
          } else if (!ended && !disposed && requestCounter === token && controller.signal.aborted && authorized(slot)) {
            failures++; lastFailureAt = now();
            move("failed");
            emit("failed", slot.id);
          }
        } finally {
          if (requestCounter !== token || ended || disposed || !authorized(slot) || state.peek() !== "ready") {
            await forgetResource(slot.id);
          }
          if (requestAbort === controller) requestAbort = undefined;
        }
      })();
      inFlight = task;
      try { await task; } finally { if (inFlight === task) inFlight = undefined; }
    };
    const disallowedPhase = (): AdSlotStateV1 => {
      if (initiated) return "revoked";
      try {
        const current = consent.snapshot();
        return current.grants.advertising?.decision === "unknown" ? "awaiting-consent" : "blocked";
      } catch { return "blocked"; }
    };
    const observeVisibility = (): void => {
      if (!element || observer || !opts.lazy) return;
      const host = element;
      if (typeof IntersectionObserver === "undefined") { visible = true; return; }
      visible = false;
      observer = new IntersectionObserver(entries => {
        if (ended || disposed) return;
        const match = entries.find(entry => entry.target === host);
        if (!match) return;
        visible = match.isIntersecting;
        if (visible) activate();
      }, { rootMargin: (opts.preloadMarginPx ?? 200) + "px" });
      observer.observe(host);
    };
    const activate = (): void => {
      if (ended || disposed || paused || !element) return;
      if (!authorized(slot)) { move(disallowedPhase()); return; }
      observeVisibility();
      if (visible) void draw(false);
    };
    const placement: AdMountedPlacementV1 & { updatePermission(): void } = {
      id: slot.id, state,
      mount(host) {
        if (ended || disposed || element) throw new Error("Advertising slot cannot be remounted");
        const marker = host.getAttribute("data-zaakiy-ad-slot");
        if (marker !== null && marker !== slot.id) throw new Error("Hydration ad slot identity mismatch");
        host.setAttribute("data-zaakiy-ad-slot", slot.id);
        host.setAttribute("role", "complementary");
        host.setAttribute("aria-label", opts.label ?? "Advertisement");
        host.style.minWidth = slot.reserve.minWidth + "px";
        host.style.minHeight = slot.reserve.minHeight + "px";
        if (slot.reserve.aspectRatio) host.style.aspectRatio = String(slot.reserve.aspectRatio);
        host.style.contain = "layout style";
        element = host;
        observeVisibility();
        activate();
      },
      async load() { await draw(false); },
      async refresh() { await draw(true); },
      pause() {
        if (ended) return;
        paused = true; cancel();
        if (state.peek() === "loading") move("idle");
      },
      resume() {
        if (ended || !paused) return;
        paused = false; activate();
      },
      updatePermission() {
        if (ended) return;
        if (authorized(slot)) {
          if (state.peek() === "revoked" || state.peek() === "blocked" ||
              state.peek() === "awaiting-consent") move("idle");
          activate();
          return;
        }
        cancel();
        observer?.disconnect(); observer = undefined;
        const phase = disallowedPhase();
        if (state.peek() !== phase) {
          move(phase);
          if (phase === "revoked") emit("revoked", slot.id);
        }
        void forgetResource(slot.id);
      },
      async dispose() {
        if (ended) return;
        ended = true;
        cancel();
        observer?.disconnect(); observer = undefined;
        placements.delete(slot.id);
        slots.delete(slot.id);
        state.value = "disposed";
        emit("disposed", slot.id);
        await forgetResource(slot.id);
      }
    };
    slots.set(slot.id, slot);
    placements.set(slot.id, placement);
    if (getOwner()) onCleanup(() => { void placement.dispose(); });
    return placement;
  };
  const onPermissionChange = (): void => {
    if (disposed) return;
    const anyAuthorized = [...slots.values()].some(authorized);
    if (!anyAuthorized) retireProvider();
    for (const slot of [...placements.values()]) slot.updatePermission();
  };
  const unsubscribe = consent.subscribe(() => onPermissionChange());
  const manager: AdsManagerV1 = {
    schema: "zaakiy.ads/1",
    register,
    get(id) { return placements.get(id); },
    async dispose() {
      if (disposed) return;
      disposed = true;
      unsubscribe();
      await Promise.all([...placements.values()].map(slot => slot.dispose()));
      retireProvider();
      await retirePromise;
      placements.clear();
      slots.clear();
    }
  };
  if (getOwner()) onCleanup(() => { void manager.dispose(); });
  return manager;
}
