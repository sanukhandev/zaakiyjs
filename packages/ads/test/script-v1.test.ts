// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { loadAuthorizedProviderScriptV1 } from "../src/script-v1.js";
import type { ConsentCapabilityV1, ConsentDecisionV1, ConsentPurposeV1, ConsentSnapshotV1 } from "../src/contract-v1.js";
function fakeConsent() {
  let allowed: ConsentDecisionV1 = "unknown";
  let revision = 0;
  const listeners = new Set<(next: ConsentSnapshotV1, previous: ConsentSnapshotV1) => void>();
  const grants = () => Object.fromEntries(
    (["essential", "analytics", "advertising", "ad-personalization", "functional-third-party"] as ConsentPurposeV1[])
      .map(p => [p, { purpose: p, decision: p === "advertising" ? allowed : "unknown" }])
  ) as unknown as ConsentSnapshotV1["grants"];
  const snapshot = (): ConsentSnapshotV1 => ({
    schema: "zaakiy.consent/1", revision, policyId: "test", policyVersion: "1", grants: grants()
  });
  const consent: ConsentCapabilityV1 = {
    schema: "zaakiy.consent/1", snapshot, can: p => p === "advertising" && allowed === "granted",
    subscribe(fn) { listeners.add(fn); return () => { listeners.delete(fn); }; }
  };
  return { consent, listeners, change(value: ConsentDecisionV1) {
    const old = snapshot(); allowed = value; revision++;
    for (const listener of [...listeners]) listener(snapshot(), old);
  } };
}
function settings(name: string, consent: ConsentCapabilityV1) {
  return {
    document, consent, purposes: ["advertising"] as const,
    signal: new AbortController().signal,
    allowedOrigins: ["https://provider.example.test"],
    src: "https://provider.example.test/" + name + ".js"
  };
}
afterEach(() => {
  for (const script of [...document.querySelectorAll("script[src]")]) script.remove();
});
describe("P3 v1 authorized script lifecycle", () => {
  it("does not insert any script until advertising is granted", async () => {
    const fixture = fakeConsent();
    await expect(loadAuthorizedProviderScriptV1(settings("no-consent", fixture.consent))).rejects.toThrow();
    expect(document.querySelector("script[src]")).toBeNull();
  });
  it("rejects unsupported URL schemes and origins even with permission", async () => {
    const fixture = fakeConsent(); fixture.change("granted");
    const opts = settings("unsafe", fixture.consent);
    await expect(loadAuthorizedProviderScriptV1({ ...opts, src: "javascript:alert(1)" })).rejects.toThrow();
    await expect(loadAuthorizedProviderScriptV1({ ...opts, src: "https://other.example.test/vendor.js" })).rejects.toThrow();
    expect(document.querySelector("script[src]")).toBeNull();
  });
  it("loads one script for concurrent authorized callers and cleans on release", async () => {
    const fixture = fakeConsent(); fixture.change("granted");
    const opts = settings("dedupe", fixture.consent);
    const first = loadAuthorizedProviderScriptV1(opts);
    const second = loadAuthorizedProviderScriptV1(opts);
    const script = document.querySelector('script[src="https://provider.example.test/dedupe.js"]');
    expect(script).not.toBeNull();
    expect(document.querySelectorAll('script[src="https://provider.example.test/dedupe.js"]')).toHaveLength(1);
    script?.dispatchEvent(new Event("load"));
    const a = await first, b = await second;
    a.dispose();
    expect(document.querySelectorAll('script[src="https://provider.example.test/dedupe.js"]')).toHaveLength(1);
    b.dispose();
    expect(document.querySelectorAll('script[src="https://provider.example.test/dedupe.js"]')).toHaveLength(0);
    await expect(loadAuthorizedProviderScriptV1(opts)).rejects.toThrow("reload");
  });
  it("cannot bypass SDK reinitialization protection by changing CSP nonce", async () => {
    const fixture = fakeConsent(); fixture.change("granted");
    const opts = settings("nonce-bypass", fixture.consent);
    const initial = loadAuthorizedProviderScriptV1({ ...opts, nonce: "first" });
    document.querySelector('script[src="https://provider.example.test/nonce-bypass.js"]')
      ?.dispatchEvent(new Event("load"));
    const lease = await initial;
    lease.dispose();
    await expect(loadAuthorizedProviderScriptV1({ ...opts, nonce: "second" }))
      .rejects.toThrow("reload");
    expect(document.querySelectorAll('script[src="https://provider.example.test/nonce-bypass.js"]'))
      .toHaveLength(0);
  });
  it("rejects duplicate active vendor URL with conflicting script options", async () => {
    const fixture = fakeConsent(); fixture.change("granted");
    const opts = settings("same-vendor", fixture.consent);
    const pending = loadAuthorizedProviderScriptV1({ ...opts, nonce: "a" });
    await expect(loadAuthorizedProviderScriptV1({ ...opts, nonce: "b" }))
      .rejects.toThrow("already owned");
    expect(document.querySelectorAll('script[src="https://provider.example.test/same-vendor.js"]'))
      .toHaveLength(1);
    document.querySelector('script[src="https://provider.example.test/same-vendor.js"]')
      ?.dispatchEvent(new Event("load"));
    const lease = await pending;
    lease.dispose();
  });
  it("revocation removes loaded scripts and invalidates the lease", async () => {
    const fixture = fakeConsent(); fixture.change("granted");
    const opts = settings("revoked", fixture.consent);
    const request = loadAuthorizedProviderScriptV1(opts);
    document.querySelector('script[src="https://provider.example.test/revoked.js"]')?.dispatchEvent(new Event("load"));
    const lease = await request;
    fixture.change("revoked");
    expect(document.querySelector('script[src="https://provider.example.test/revoked.js"]')).toBeNull();
    lease.dispose();
    expect(fixture.listeners.size).toBe(0);
  });
  it("aborting the only consumer prevents pending code from loading", async () => {
    const fixture = fakeConsent(); fixture.change("granted");
    const controller = new AbortController();
    const opts = { ...settings("abort-v1", fixture.consent), signal: controller.signal };
    const pending = loadAuthorizedProviderScriptV1(opts);
    controller.abort();
    await expect(pending).rejects.toThrow();
    expect(document.querySelector('script[src="https://provider.example.test/abort-v1.js"]')).toBeNull();
  });
});
