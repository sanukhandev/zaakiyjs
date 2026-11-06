// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { loadAuthorizedProviderScript } from "../src/index.js";
const granted = { check: () => "granted" as const, subscribe: () => () => undefined };
const options = (name: string) => ({
  document, consent: granted, purposes: ["ads"], signal: new AbortController().signal,
  src: "https://ads.example.test/" + name + ".js", allowedOrigins: ["https://ads.example.test"]
});
afterEach(() => { for (const script of [...document.querySelectorAll("script[src]")]) script.remove(); });

describe("script helper resource bounds", () => {
  it("bounds simultaneous distinct vendor script insertions without polling", async () => {
    const one = loadAuthorizedProviderScript(options("parallel-one"));
    const two = loadAuthorizedProviderScript(options("parallel-two"));
    const three = loadAuthorizedProviderScript(options("parallel-three"));
    await expect(three).rejects.toThrow("concurrency limit");
    expect(document.querySelectorAll('script[src^="https://ads.example.test/parallel-"]')).toHaveLength(2);
    document.querySelector('script[src="https://ads.example.test/parallel-one.js"]')?.dispatchEvent(new Event("load"));
    document.querySelector('script[src="https://ads.example.test/parallel-two.js"]')?.dispatchEvent(new Event("load"));
    await Promise.all([one, two]);
  });
  it("releases the failed-script cache so a fresh authorized load may retry", async () => {
    const first = loadAuthorizedProviderScript(options("retry"));
    document.querySelector('script[src="https://ads.example.test/retry.js"]')?.dispatchEvent(new Event("error"));
    await expect(first).rejects.toThrow();
    const second = loadAuthorizedProviderScript(options("retry"));
    expect(document.querySelectorAll('script[src="https://ads.example.test/retry.js"]')).toHaveLength(1);
    document.querySelector('script[src="https://ads.example.test/retry.js"]')?.dispatchEvent(new Event("load"));
    await expect(second).resolves.toBeUndefined();
  });
});
