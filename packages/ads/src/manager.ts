import { getOwner, onCleanup } from "@zaakiyjs/core";
import { signal } from "@zaakiyjs/signals";
import type {
  AdEventType, AdLoadResult, AdProvider, AdRequest, AdsManager, AdsManagerOptions,
  AdSize, AdSlot, AdSlotConfig, AdSlotState, ConsentDecision
} from "./types.js";

function validId(id: string): boolean { return /^[A-Za-z][A-Za-z0-9_-]{0,127}$/.test(id); }
function validSize(size: AdSize): boolean {
  return Number.isSafeInteger(size.width) && size.width > 0 && size.width <= 4096 &&
    Number.isSafeInteger(size.height) && size.height > 0 && size.height <= 4096;
}
function validate(config: AdSlotConfig): void {
  if (config.mode !== "personalized" && config.mode !== "nonpersonalized") throw new TypeError("Invalid ad mode");
  if (!validId(config.id) || !validId(config.providerId) || !config.placement.trim() ||
      config.placement.length > 256) throw new TypeError("Invalid ad slot identity");
  if (!Number.isSafeInteger(config.minHeight) || config.minHeight < 1 || config.minHeight > 4096) {
    throw new RangeError("Invalid ad slot reserved height");
  }
  if (config.size && !validSize(config.size)) throw new RangeError("Invalid ad slot size");
  if (config.responsive) {
    let previous = -1;
    for (const item of config.responsive) {
      if (!Number.isSafeInteger(item.minWidth) || item.minWidth < 0 || item.minWidth <= previous || !validSize(item.size)) {
        throw new RangeError("Responsive sizes must be valid and strictly ascending");
      }
      previous = item.minWidth;
    }
  }
  if (config.preloadMarginPx !== undefined &&
      (!Number.isSafeInteger(config.preloadMarginPx) || config.preloadMarginPx < 0 || config.preloadMarginPx > 4000)) {
    throw new RangeError("Invalid preload margin");
  }
  if (config.refresh && (!Number.isSafeInteger(config.refresh.minIntervalMs) || config.refresh.minIntervalMs < 30000)) {
    throw new RangeError("Ad refresh interval must be at least 30 seconds");
  }
  if (config.label !== undefined && config.label.length > 160) throw new RangeError("Ad label too long");
}

interface InitState { ready: boolean; pending?: Promise<void>; reloadRequired: boolean; abort: AbortController }

export function createAdsManager(options: AdsManagerOptions): AdsManager {
  const providers = new Map<string, AdProvider>();
  const initialized = new Map<string, InitState>();
  const revokedProviders = new Set<string>();
  const slots = new Map<string, AdSlot & { onConsentChange(): void }>();
  let disposed = false;
  const now = options.now ?? Date.now;
  const doc = options.document ?? (typeof document !== "undefined" ? document : undefined);
  const emit = (type: AdEventType, slotId: string, providerId: string): void => {
    try { options.onEvent?.({ type, slotId, providerId }); }
    catch { /* telemetry must not break ad lifecycle */ }
  };
  const registerProvider = (provider: AdProvider): void => {
    if (disposed) throw new Error("Ads manager disposed");
    if (!validId(provider.id) || providers.has(provider.id)) throw new TypeError("Invalid or duplicate provider");
    providers.set(provider.id, provider);
    initialized.set(provider.id, { ready: false, reloadRequired: false, abort: new AbortController() });
  };
  for (const provider of options.providers ?? []) registerProvider(provider);

  const safeDecision = (purposes: readonly string[]): ConsentDecision => {
    try {
      const answer = options.consent.check(purposes);
      return answer === "granted" || answer === "denied" ? answer : "unknown";
    } catch {
      return "unknown";
    }
  };
  const registerSlot = (config: AdSlotConfig): AdSlot => {
    if (disposed) throw new Error("Ads manager disposed");
    validate(config);
    if (slots.has(config.id)) throw new TypeError("Duplicate ad slot");
    const provider = providers.get(config.providerId);
    if (!provider) throw new TypeError("Unknown advertising provider");
    for (const previous of slots.values()) {
      const existing = slotConfigs.get(previous);
      if (existing?.providerId === config.providerId && existing.mode !== config.mode) {
        throw new Error("One provider cannot mix personalized and nonpersonalized modes");
      }
    }
    const purposes = [...new Set([...provider.requiredPurposes, ...(config.requiredPurposes ?? [])])];
    // No implicit consent-free mode; even nonpersonalized traffic requires an explicit gate verdict.
    const authorization = (): ConsentDecision => safeDecision(purposes);
    const state = signal<AdSlotState>({ phase: "registered" });
    let element: HTMLElement | undefined;
    let observer: IntersectionObserver | undefined;
    let resizeObserver: ResizeObserver | undefined;
    let measuredWidth = 0;
    let visible = !config.lazy;
    let paused = false;
    let slotDisposed = false;
    let generation = 0;
    let controller: AbortController | undefined;
    let lastRequest = -Infinity;
    let failures = 0;
    let refreshable = false;
    const setState = (phase: AdSlotState["phase"], errorCode?: AdSlotState["errorCode"]): void => {
      state.value = errorCode ? { phase, errorCode } : { phase };
    };
    const cancel = (): void => { generation++; controller?.abort(); controller = undefined; };
    const reserve = (node: HTMLElement): void => {
      const current = node.getAttribute("data-zaakiy-ad-slot");
      if (current !== null && current !== config.id) throw new Error("Hydrated ad slot ID mismatch");
      node.setAttribute("data-zaakiy-ad-slot", config.id);
      node.setAttribute("role", "complementary");
      node.setAttribute("aria-label", config.label ?? "Advertisement");
      node.style.minHeight = config.minHeight + "px";
      node.style.contain = "layout style";
      // Do not force a fixed minimum width: mobile placement containers may be narrower.
    };
    const getDimensions = (): AdSize | undefined => {
      if (!config.responsive?.length || !element) return config.size;
      // ResizeObserver data avoids synchronous layout reads during ad loading.
      const width = measuredWidth;
      let choice = config.size;
      for (const item of config.responsive) if (width >= item.minWidth) choice = item.size;
      return choice;
    };
    const ensureProvider = async (mode: AdSlotConfig["mode"]): Promise<void> => {
      const entry = initialized.get(provider.id);
      if (!entry || entry.reloadRequired) throw new Error("Provider requires full page reload after consent revocation");
      if (entry.ready) return;
      if (!entry.pending) {
        entry.pending = Promise.resolve().then(() => {
          if (entry.abort.signal.aborted || authorization() !== "granted" || revokedProviders.has(provider.id)) {
            throw new Error("Ad provider initialization no longer authorized");
          }
          return provider.initialize({ mode, signal: entry.abort.signal });
        })
          .then(() => { if (!entry.abort.signal.aborted) entry.ready = true; })
          .finally(() => { entry.pending = undefined; });
      }
      await entry.pending;
      if (!entry.ready) throw new Error("Provider initialization aborted");
    };
    const begin = async (refresh: boolean): Promise<boolean> => {
      if (disposed || slotDisposed || !element || paused) return false;
      const consent = authorization();
      if (consent !== "granted" || revokedProviders.has(provider.id)) {
        cancel();
        setState(consent === "denied" || revokedProviders.has(provider.id) ? "blocked" : "waiting-consent");
        return false;
      }
      if (!visible) { setState("waiting-visibility"); return false; }
      if (initialized.get(provider.id)?.reloadRequired) { setState("blocked"); return false; }
      if (refresh) {
        if (!refreshable || !config.refresh?.enabled || !provider.supportsRefresh || !provider.refresh ||
          (config.refresh.requireVisibility !== false && doc?.visibilityState === "hidden")) return false;
        const interval = Math.max(config.refresh.minIntervalMs, provider.minRefreshIntervalMs ?? 30000);
        if (now() - lastRequest < interval * Math.pow(2, Math.min(failures, 4))) return false;
      }
      cancel();
      const token = generation;
      const requestAbort = new AbortController();
      controller = requestAbort;
      setState("loading");
      lastRequest = now();
      emit("slot-requested", config.id, provider.id);
      const request: AdRequest = {
        slotId: config.id, placement: config.placement, format: config.format,
        mode: config.mode, element, dimensions: getDimensions(), signal: requestAbort.signal
      };
      try {
        await ensureProvider(config.mode);
        if (token !== generation || requestAbort.signal.aborted || authorization() !== "granted") return false;
        emit("provider-loading", config.id, provider.id);
        const result: AdLoadResult = await (refresh ? provider.refresh!(request) : provider.load(request));
        if (token !== generation || requestAbort.signal.aborted || authorization() !== "granted") return false;
        failures = 0;
        if (result.status === "filled") {
          refreshable = true;
          setState("filled"); emit("filled", config.id, provider.id);
          if (result.impressionConfirmed === true) emit("impression-confirmed", config.id, provider.id);
        } else if (result.status === "empty") {
          refreshable = true;
          setState("empty"); emit("empty", config.id, provider.id);
        } else if (result.status === "blocked") {
          setState("blocked", "provider-blocked"); emit("blocked", config.id, provider.id);
        } else {
          throw new Error("Invalid provider response");
        }
        if (refresh) emit("refreshed", config.id, provider.id);
        return true;
      } catch {
        if (token === generation && !requestAbort.signal.aborted) {
          failures++;
          setState("failed", "provider-error");
          emit("failed", config.id, provider.id);
        }
        return false;
      } finally {
        if (controller === requestAbort) controller = undefined;
      }
    };
    const activate = (): void => {
      if (!element || slotDisposed || disposed || paused) return;
      const decision = authorization();
      if (decision !== "granted" || revokedProviders.has(provider.id)) {
        cancel();
        setState(decision === "denied" || revokedProviders.has(provider.id) ? "blocked" : "waiting-consent");
        return;
      }
      if (!visible) { setState("waiting-visibility"); return; }
      if (state.peek().phase === "registered" || state.peek().phase === "waiting-consent" ||
          state.peek().phase === "blocked" || state.peek().phase === "waiting-visibility") {
        void begin(false);
      }
    };
    const slot: AdSlot & { onConsentChange(): void } = {
      id: config.id, state,
      mount(node) {
        if (slotDisposed || disposed || element) throw new Error("Ad slot already mounted or disposed");
        reserve(node);
        element = node;
        if (config.responsive?.length && typeof ResizeObserver !== "undefined") {
          resizeObserver = new ResizeObserver(entries => {
            const match = entries.find(entry => entry.target === node);
            if (match) measuredWidth = match.contentRect.width;
          });
          resizeObserver.observe(node);
        }
        if (config.lazy && typeof IntersectionObserver !== "undefined") {
          observer = new IntersectionObserver(entries => {
            if (slotDisposed || disposed) return;
            visible = entries.some(entry => entry.target === node && entry.isIntersecting);
            if (visible) activate();
          }, { rootMargin: (config.preloadMarginPx ?? 200) + "px" });
          observer.observe(node);
        } else {
          // Without IntersectionObserver an eager fallback is safer than a permanently blank slot.
          visible = true;
        }
        activate();
      },
      async load() {
        if (!["loading", "filled", "empty"].includes(state.peek().phase)) await begin(false);
      },
      async refresh() { return begin(true); },
      pause() {
        if (slotDisposed) return;
        paused = true; cancel();
        if (state.peek().phase === "loading") setState("registered");
      },
      resume() {
        if (slotDisposed || !paused) return;
        paused = false; activate();
      },
      onConsentChange() {
        if (slotDisposed) return;
        const decision = authorization();
        if (decision !== "granted" || revokedProviders.has(provider.id)) {
          cancel(); refreshable = false;
          setState(decision === "denied" || revokedProviders.has(provider.id) ? "blocked" : "waiting-consent");
        } else {
          if (state.peek().phase === "filled" && !initialized.get(provider.id)?.ready) setState("registered");
          activate();
        }
      },
      dispose() {
        if (slotDisposed) return;
        slotDisposed = true; cancel(); refreshable = false; observer?.disconnect(); resizeObserver?.disconnect();
        if (element && provider.unmount) {
          try { void Promise.resolve(provider.unmount(config.id, element)).catch(() => undefined); }
          catch { /* provider teardown is best effort */ }
        }
        element = undefined;
        slots.delete(config.id);
        setState("disposed"); emit("disposed", config.id, provider.id);
      }
    };
    slots.set(config.id, slot);
    if (getOwner()) onCleanup(() => slot.dispose());
    return slot;
  };
  const onConsentChange = (): void => {
    if (disposed) return;
    for (const [id, provider] of providers) {
      // Provider scripts may be shared across slots; an unauthorized slot blocks
      // the provider for the whole manager until that provider is fully authorized.
      const denied = [...slots.values()].some(slot => {
        const config = slotConfigs.get(slot);
        return config?.providerId === id && safeDecision([...new Set([...provider.requiredPurposes, ...(config.requiredPurposes ?? [])])]) !== "granted";
      });
      if (denied) revokedProviders.add(id);
      else revokedProviders.delete(id);
      const current = initialized.get(id);
      if (!current || (!current.ready && !current.pending) || !denied) continue;
      if (denied) {
        current.abort.abort(); current.ready = false;
        current.reloadRequired = !provider.reinitializeAfterRevocation;
        if (!current.reloadRequired) initialized.set(id, { ready: false, reloadRequired: false, abort: new AbortController() });
        try { void Promise.resolve(provider.dispose?.()).catch(() => undefined); } catch { /* safe failure */ }
      }
    }
    for (const slot of [...slots.values()]) slot.onConsentChange();
  };
  // Kept per manager, never global. Registration and disposal do not require a Router import.
  const slotConfigs = new WeakMap<AdSlot, AdSlotConfig>();
  const registered = registerSlot;
  const registerAndTrack = (config: AdSlotConfig): AdSlot => {
    const slot = registered(config);
    slotConfigs.set(slot, config);
    return slot;
  };
  const unsubscribe = options.consent.subscribe(onConsentChange);
  const manager: AdsManager = {
    registerProvider, registerSlot: registerAndTrack,
    getSlot: id => slots.get(id),
    dispose() {
      if (disposed) return;
      disposed = true; unsubscribe();
      for (const slot of [...slots.values()]) slot.dispose();
      for (const [id, provider] of providers) {
        initialized.get(id)?.abort.abort();
        try { void Promise.resolve(provider.dispose?.()).catch(() => undefined); } catch { /* safe failure */ }
      }
      slots.clear(); providers.clear(); initialized.clear(); revokedProviders.clear();
    }
  };
  if (getOwner()) onCleanup(() => manager.dispose());
  return manager;
}
