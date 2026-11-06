// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { loadAuthorizedProviderScript } from "../src/scripts.js";
const consent = { check: () => "granted" as const, subscribe: () => () => undefined };
afterEach(() => {
  for (const node of [...document.querySelectorAll("script[src]")]) node.remove();
});
describe("explicit provider script loader", () => {
  it("rejects arbitrary schemes, credentials, and unapproved origins without DOM insertion", async () => {
    const controller = new AbortController();
    const base = { document, consent, purposes: ["ads"], allowedOrigins: ["https://cdn.example.test"], signal: controller.signal };
    for (const src of ["javascript:alert(1)", "https://evil.test/ad.js", "http://cdn.example.test/ad.js", "https://user:pw@cdn.example.test/ad.js"]) {
      await expect(loadAuthorizedProviderScript({ ...base, src })).rejects.toThrow();
    }
    expect(document.querySelector("script[src]")).toBeNull();
  });
  it("refuses to inject when consent is unknown or denied", async () => {
    const controller = new AbortController();
    await expect(loadAuthorizedProviderScript({
      document, consent: { ...consent, check: () => "unknown" as const },
      purposes: ["ads"], src: "https://cdn.example.test/auth.js",
      allowedOrigins: ["https://cdn.example.test"], signal: controller.signal
    })).rejects.toThrow("not authorized");
    expect(document.querySelector('script[src="https://cdn.example.test/auth.js"]')).toBeNull();
  });
  it("stops a pending script if permission is revoked", async () => {
    const callbacks = new Set<() => void>();
    let allowed = true;
    const gate = {
      check: () => allowed ? "granted" as const : "denied" as const,
      subscribe: (cb: () => void) => { callbacks.add(cb); return () => { callbacks.delete(cb); }; }
    };
    const src = "https://cdn.example.test/revocable.js";
    const request = loadAuthorizedProviderScript({
      document, consent: gate, purposes: ["ads"], src,
      allowedOrigins: ["https://cdn.example.test"], signal: new AbortController().signal
    });
    expect(document.querySelector('script[src="' + src + '"]')).not.toBeNull();
    allowed = false;
    for (const cb of callbacks) cb();
    await expect(request).rejects.toThrow();
    expect(document.querySelector('script[src="' + src + '"]')).toBeNull();
    expect(callbacks.size).toBe(0);
  });
  it("honors an aborted signal and does not inject a script", async () => {
    const controller = new AbortController(); controller.abort();
    await expect(loadAuthorizedProviderScript({
      document, consent, purposes: ["ads"], src: "https://cdn.example.test/ad.js", allowedOrigins: ["https://cdn.example.test"], signal: controller.signal
    })).rejects.toThrow();
    expect(document.querySelector("script[src]")).toBeNull();
  });
  it("supports CSP and deduplicates the authorized script", async () => {
    const controller = new AbortController();
    const options = {
      document, consent, purposes: ["ads"], src: "https://cdn.example.test/library.js", allowedOrigins: ["https://cdn.example.test"],
      nonce: "abc123", integrity: "sha384-abc", crossOrigin: "anonymous" as const, signal: controller.signal
    };
    const first = loadAuthorizedProviderScript(options);
    const second = loadAuthorizedProviderScript(options);
    expect(first).toBe(second);
    const script = document.querySelector<HTMLScriptElement>('script[src="https://cdn.example.test/library.js"]');
    expect(script).not.toBeNull();
    expect(script?.nonce).toBe("abc123");
    expect(script?.integrity).toBe("sha384-abc");
    script?.dispatchEvent(new Event("load"));
    await expect(first).resolves.toBeUndefined();
    await expect(second).resolves.toBeUndefined();
    expect(document.querySelectorAll('script[src="https://cdn.example.test/library.js"]')).toHaveLength(1);
  });
  it("cleans failed/aborted script insertions without claiming SDK unload", async () => {
    const controller = new AbortController();
    const options = {
      document, consent, purposes: ["ads"], src: "https://cdn.example.test/blocked.js",
      allowedOrigins: ["https://cdn.example.test"], signal: controller.signal
    };
    const promise = loadAuthorizedProviderScript(options);
    expect(document.querySelectorAll('script[src="https://cdn.example.test/blocked.js"]')).toHaveLength(1);
    controller.abort();
    await expect(promise).rejects.toThrow();
    expect(document.querySelectorAll('script[src="https://cdn.example.test/blocked.js"]')).toHaveLength(0);
  });
});
