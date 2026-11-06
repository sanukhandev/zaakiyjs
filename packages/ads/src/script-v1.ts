import type { AdvertisingPurposeV1, ConsentCapabilityV1 } from "./contract-v1.js";

export interface AdScriptOptionsV1 {
  readonly consent: ConsentCapabilityV1;
  readonly purposes: readonly AdvertisingPurposeV1[];
  readonly document: Document;
  readonly src: string;
  readonly allowedOrigins: readonly string[];
  readonly signal: AbortSignal;
  readonly nonce?: string;
  readonly integrity?: string;
  readonly crossOrigin?: "anonymous" | "use-credentials";
  readonly timeoutMs?: number;
}
export interface AdScriptLeaseV1 {
  readonly url: string;
  /** Removes the script tag; already-evaluated SDK globals cannot be unloaded by DOM removal. */
  dispose(): void;
}
interface Resource {
  readonly consent: ConsentCapabilityV1;
  readonly purposes: readonly AdvertisingPurposeV1[];
  readonly url: string;
  readonly ready: Promise<void>;
  readonly retire: () => void;
  readonly users: Set<() => void>;
  readonly loaded: () => boolean;
}
interface ScriptRegistry {
  readonly entries: Map<string, Resource>;
  readonly exhausted: Set<string>;
}
const registries = new WeakMap<Document, ScriptRegistry>();
const MAX_LOADING_SCRIPTS = 2;

function authorized(capability: ConsentCapabilityV1, purposes: readonly AdvertisingPurposeV1[]): boolean {
  try {
    if (capability.schema !== "zaakiy.consent/1" || !purposes.includes("advertising")) return false;
    const state = capability.snapshot();
    if (state.schema !== "zaakiy.consent/1" || !Number.isSafeInteger(state.revision) ||
        state.revision < 0 || !state.policyId || !state.policyVersion) return false;
    return purposes.every(p => state.grants[p]?.purpose === p &&
      state.grants[p].decision === "granted" && capability.can(p) === true);
  } catch { return false; }
}
function checkedUrl(options: AdScriptOptionsV1): string {
  let url: URL;
  try { url = new URL(options.src); }
  catch { throw new TypeError("Invalid advertising script URL"); }
  if (url.protocol !== "https:" || url.username || url.password ||
      !options.allowedOrigins.includes(url.origin)) throw new TypeError("Unapproved advertising script origin");
  return url.href;
}

/** Optional SDK script lifecycle bound to an explicit approved consent capability. */
export async function loadAuthorizedProviderScriptV1(options: AdScriptOptionsV1): Promise<AdScriptLeaseV1> {
  if (options.signal.aborted || !authorized(options.consent, options.purposes)) {
    throw new Error("Advertisement script is not authorized");
  }
  const src = checkedUrl(options);
  const timeout = options.timeoutMs ?? 8000;
  if (!Number.isSafeInteger(timeout) || timeout < 100 || timeout > 120000) {
    throw new TypeError("Invalid advertising script deadline");
  }
  const registry = registries.get(options.document) ?? { entries: new Map(), exhausted: new Set() };
  registries.set(options.document, registry);
  const key = [src, options.nonce ?? "", options.integrity ?? "", options.crossOrigin ?? ""].join("|");
  // Vendor SDK side effects survive script-tag removal. Changing CSP nonce/SRI
  // attributes must not bypass the session-level no-reinitialization rule.
  if (registry.exhausted.has(src)) throw new Error("Provider script requires a page reload before reinitialization");
  if ([...registry.entries.values()].some(e => e.url === src && !registry.entries.has(key))) {
    throw new Error("Provider script URL is already owned with different loading options");
  }
  let resource = registry.entries.get(key);
  if (resource && (resource.consent !== options.consent ||
      resource.purposes.join(",") !== options.purposes.join(","))) {
    throw new Error("Ad script cannot be shared across independent consent scopes");
  }
  if (!resource) {
    const pending = [...registry.entries.values()].filter(e => !e.loaded()).length;
    if (pending >= MAX_LOADING_SCRIPTS) throw new Error("Advertising script concurrency limit reached");
    const doc = options.document;
    const node = doc.createElement("script");
    node.async = true;
    node.src = src;
    if (options.nonce) node.nonce = options.nonce;
    if (options.integrity) node.integrity = options.integrity;
    if (options.crossOrigin) node.crossOrigin = options.crossOrigin;
    let loaded = false;
    let ended = false;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    let unsubscribe: () => void = () => undefined;
    let resolve!: () => void;
    let reject!: (error: Error) => void;
    const ready = new Promise<void>((res, rej) => { resolve = res; reject = rej; });
    const cleanup = (): void => {
      if (deadline) clearTimeout(deadline);
      node.removeEventListener("load", success);
      node.removeEventListener("error", failure);
    };
    const retire = (): void => {
      if (ended) return;
      ended = true;
      cleanup(); unsubscribe();
      node.remove();
      registry.entries.delete(key);
      if (loaded) registry.exhausted.add(src);
      else reject(new Error("Advertising script cancelled before load"));
    };
    const success = (): void => {
      if (ended) return;
      loaded = true; cleanup(); resolve();
    };
    const failure = (): void => {
      if (ended) return;
      retire();
    };
    const users = new Set<() => void>();
    resource = { consent: options.consent, purposes: [...options.purposes], url: src, ready, retire, users, loaded: () => loaded };
    registry.entries.set(key, resource);
    try {
      unsubscribe = options.consent.subscribe(() => {
        if (!authorized(options.consent, options.purposes)) retire();
      });
      if (options.signal.aborted || !authorized(options.consent, options.purposes)) retire();
      else {
        node.addEventListener("load", success, { once: true });
        node.addEventListener("error", failure, { once: true });
        deadline = setTimeout(retire, timeout);
        const target = doc.head ?? doc.body;
        if (!target) retire();
        else target.append(node);
      }
    } catch {
      retire();
    }
  }
  const entry = resource;
  if (!entry) throw new Error("Ad script initialization failed");
  let released = false;
  const release = (): void => {
    if (released) return;
    released = true;
    options.signal.removeEventListener("abort", release);
    entry.users.delete(release);
    if (entry.users.size === 0) entry.retire();
  };
  entry.users.add(release);
  options.signal.addEventListener("abort", release, { once: true });
  try {
    await entry.ready;
    if (options.signal.aborted || !authorized(options.consent, options.purposes)) {
      throw new Error("Advertising script grant was revoked");
    }
    return { url: src, dispose: release };
  } catch {
    release();
    throw new Error("Advertising script did not complete its authorized load");
  }
}
