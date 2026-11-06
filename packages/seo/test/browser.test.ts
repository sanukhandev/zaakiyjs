// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { createHeadManager } from "../src/browser.js";
import { renderMetadata } from "../src/index.js";
const policy = { siteURL: "https://example.com" };
describe("SPA head updates", () => {
  it("reuses SSR head, removes old route tags, avoids duplicate canonicals", () => {
    document.head.innerHTML = '<title>SSR</title><link rel="canonical" href="https://example.com/ssr">';
    const manager = createHeadManager(document);
    expect(manager.update(renderMetadata({ title: "One", canonical: "/a", description: "Desc" }, policy), { version: 1 })).toBe(true);
    expect(manager.update(renderMetadata({ title: "Two", canonical: "/b" }, policy), { version: 2 })).toBe(true);
    expect(document.title).toBe("Two");
    expect(document.head.querySelectorAll('link[rel="canonical"]')).toHaveLength(1);
    expect(document.head.querySelector('meta[name="description"]')).toBeNull();
    manager.dispose();
  });
  it("ignores stale/aborted navigation and cleans up on owner disposal", () => {
    document.head.innerHTML = "";
    const lifetime = new AbortController();
    const pending = new AbortController();
    const manager = createHeadManager(document, lifetime.signal);
    expect(manager.update(renderMetadata({ title: "Latest" }, policy), { version: 10 })).toBe(true);
    expect(manager.update(renderMetadata({ title: "Old" }, policy), { version: 9 })).toBe(false);
    pending.abort();
    expect(manager.update(renderMetadata({ title: "Old" }, policy), { version: 11, signal: pending.signal })).toBe(false);
    expect(document.title).toBe("Latest");
    lifetime.abort();
    expect(manager.update(renderMetadata({ title: "Other" }, policy))).toBe(false);
    expect(document.head.querySelector('[data-zaakiy-seo]')).toBeNull();
  });
});
