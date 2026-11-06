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
  it("adopts and removes obsolete SSR SEO tags on the first private navigation", () => {
    document.head.innerHTML = [
      '<meta charset="utf-8">',
      '<meta name="viewport" content="width=device-width">',
      '<title>Old product</title>',
      '<meta name="description" content="Old product description">',
      '<link rel="canonical" href="https://example.com/old">',
      '<link rel="canonical" href="https://example.com/duplicate">',
      '<meta property="og:title" content="Old product">',
      '<meta name="twitter:title" content="Old product">',
      '<link rel="alternate" hreflang="fr" href="https://example.com/fr">',
      '<script type="application/ld+json">{"@type":"Product","name":"Old product"}</script>'
    ].join("");
    const head = createHeadManager(document);
    const privatePage = renderMetadata({ title: "Private", canonical: "/secret" },
      { ...policy, status: 200, private: true });
    expect(head.update(privatePage, { version: 1 })).toBe(true);
    expect(document.head.querySelectorAll('link[rel="canonical"]')).toHaveLength(0);
    expect(document.head.querySelectorAll('link[hreflang]')).toHaveLength(0);
    expect(document.head.querySelectorAll('meta[property^="og:"]')).toHaveLength(0);
    expect(document.head.querySelectorAll('meta[name^="twitter:"]')).toHaveLength(0);
    expect(document.head.querySelectorAll('script[type="application/ld+json"]')).toHaveLength(0);
    expect(document.head.querySelector('meta[name="description"]')).toBeNull();
    expect(document.head.querySelector('meta[name="robots"]')?.getAttribute("content")).toBe("noindex, nofollow");
    expect(document.head.querySelector('meta[name="viewport"]')?.getAttribute("content")).toBe("width=device-width");
    expect(document.head.querySelector('meta[charset]')).not.toBeNull();
    head.dispose();
  });
  it("adopts one canonical, removes SSR duplicates and preserves unrelated head tags", () => {
    document.head.innerHTML =
      '<link rel="canonical" href="https://example.com/old">' +
      '<link rel="canonical" href="https://example.com/duplicate">' +
      '<meta name="viewport" content="width=device-width">';
    const manager = createHeadManager(document);
    expect(manager.update(renderMetadata({ title: "New", canonical: "/new" }, policy))).toBe(true);
    const canonicals = document.head.querySelectorAll('link[rel="canonical"]');
    expect(canonicals).toHaveLength(1);
    expect(canonicals[0]?.getAttribute("href")).toBe("https://example.com/new");
    expect(document.head.querySelector('meta[name="viewport"]')).not.toBeNull();
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
