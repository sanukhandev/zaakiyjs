import type { AdsConsentGate } from "./types.js";

export interface ProviderScriptOptions {
  readonly consent: AdsConsentGate;
  readonly purposes: readonly string[];
  readonly document: Document;
  readonly src: string;
  readonly allowedOrigins: readonly string[];
  readonly nonce?: string;
  readonly integrity?: string;
  readonly crossOrigin?: "anonymous" | "use-credentials";
  /** Must only be obtained from an already-authorized provider initializer. */
  readonly signal: AbortSignal;
}

const byDocument = new WeakMap<Document, Map<string, Promise<void>>>();
const activeByDocument = new WeakMap<Document, number>();
const MAX_PARALLEL_SCRIPTS = 2;

/** Loads an explicitly allowed vendor script. Does not grant permission or initialize an SDK. */
export function loadAuthorizedProviderScript(options: ProviderScriptOptions): Promise<void> {
  if (options.signal.aborted) return Promise.reject(new Error("Ad script load aborted"));
  try {
    if (options.consent.check(options.purposes) !== "granted") return Promise.reject(new Error("Ad script not authorized"));
  } catch { return Promise.reject(new Error("Ad script not authorized")); }
  let parsed: URL;
  try { parsed = new URL(options.src); }
  catch { return Promise.reject(new TypeError("Invalid provider script URL")); }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password ||
      !options.allowedOrigins.includes(parsed.origin)) {
    return Promise.reject(new TypeError("Provider script origin is not approved"));
  }
  const key = parsed.href + "|" + (options.integrity ?? "") + "|" + (options.crossOrigin ?? "") + "|" + (options.nonce ?? "");
  let scripts = byDocument.get(options.document);
  if (!scripts) { scripts = new Map(); byDocument.set(options.document, scripts); }
  const existing = scripts.get(key);
  if (existing) return existing;
  if ((activeByDocument.get(options.document) ?? 0) >= MAX_PARALLEL_SCRIPTS) {
    return Promise.reject(new Error("Ad script concurrency limit reached"));
  }
  activeByDocument.set(options.document, (activeByDocument.get(options.document) ?? 0) + 1);
  let script: HTMLScriptElement | undefined;
  const pending = new Promise<void>((resolve, reject) => {
    const doc = options.document;
    script = doc.createElement("script");
    script.async = true;
    script.src = parsed.href;
    if (options.nonce) script.nonce = options.nonce;
    if (options.integrity) script.integrity = options.integrity;
    if (options.crossOrigin) script.crossOrigin = options.crossOrigin;
    let unsubscribe: () => void = () => undefined;
    let released = false;
    const cleanup = (): void => {
      if (released) return;
      released = true;
      activeByDocument.set(doc, Math.max(0, (activeByDocument.get(doc) ?? 1) - 1));
      unsubscribe();
      options.signal.removeEventListener("abort", abort);
      script?.removeEventListener("load", loaded);
      script?.removeEventListener("error", failed);
    };
    const loaded = (): void => { cleanup(); resolve(); };
    const failed = (): void => {
      cleanup();
      script?.remove();
      reject(new Error("Approved provider script failed to load"));
    };
    const abort = (): void => {
      cleanup();
      script?.remove();
      reject(new Error("Ad script load aborted"));
    };
    options.signal.addEventListener("abort", abort, { once: true });
    try {
      unsubscribe = options.consent.subscribe(() => {
        try { if (options.consent.check(options.purposes) !== "granted") abort(); }
        catch { abort(); }
      });
    } catch { abort(); return; }
    script.addEventListener("load", loaded, { once: true });
    script.addEventListener("error", failed, { once: true });
    if (options.signal.aborted) { abort(); return; }
    try { if (options.consent.check(options.purposes) !== "granted") { abort(); return; } }
    catch { abort(); return; }
    const target = doc.head ?? doc.body;
    if (!target) { failed(); return; }
    target.appendChild(script);
  });
  // A failed/aborted load can be retried after a new authorization check.
  const cached = pending.catch(error => {
    if (scripts?.get(key) === cached) scripts.delete(key);
    throw error;
  });
  scripts.set(key, cached);
  return cached;
}
