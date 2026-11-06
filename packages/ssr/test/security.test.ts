import { describe, expect, it } from "vitest";
import { escapeHtml, htmlDocument, safeJson, serializeHead, serializeHydration, safeLocation } from "../src/security.js";
import { validateRenderPolicy } from "../src/config.js";
describe("SSR serialization and policy hardening", () => {
  it("escapes untrusted metadata without executing HTML or JSON-LD script breakouts", () => {
    expect(escapeHtml("<script>\"&")).toBe("&lt;script&gt;&quot;&amp;");
    const page = htmlDocument("<main>trusted fixture</main>", [
      { tag: "title", text: "<img src=x onerror=alert(1)>" },
      { tag: "script-jsonld", text: JSON.stringify({ name: "</script><script>alert(1)</script>" }) }
    ], "https://shop.example.test", "nonce");
    expect(page).not.toContain("</script><script>");
    expect(page).toContain("\\u003c/script\\u003e");
    expect(page).toContain("&lt;img");
    expect(() => serializeHead([{ tag: "link", attributes: { rel: "canonical",
      href: "javascript:alert(1)" } }], "https://shop.example.test")).toThrow();
    expect(() => serializeHead([{ tag: "meta", attributes: { onclick: "bad" } }],
      "https://shop.example.test")).toThrow();
  });
  it("rejects untrusted JSON prototype, getters, sensitive fields and oversized data", () => {
    expect(() => safeJson({ public: { token: "abc" } }, ["public"])).toThrow();
    expect(() => safeJson({ other: 3 }, ["public"])).toThrow();
    expect(() => safeJson({ public: new Date() }, ["public"])).toThrow();
    expect(() => safeJson({ public: { get x() { throw Error("getter executed"); } } }, ["public"])).toThrow();
    expect(() => safeJson({ public: "a".repeat(1000) }, ["public"], 10)).toThrow();
    expect(safeJson({ public: "</script>" }, ["public"])).toContain("\\u003c");
  });
  it("enforces hydration version and duplicate identity", () => {
    expect(() => serializeHydration({ schema: "zaakiy.hydration/1", buildId: "a".repeat(64),
      domAbiVersion: 1, routeId: "p", boundaries: [
        { markerId: "b".repeat(32), templateDigest: "c".repeat(64) },
        { markerId: "b".repeat(32), templateDigest: "d".repeat(64) }
      ], payload: { public: 1 } }, ["public"])).toThrow(/marker/);
  });
  it("validates cache policies and redirect origins", () => {
    expect(() => validateRenderPolicy({ version: 1, routeId: "a", mode: "hybrid",
      cache: { scope: "public", ttlSeconds: -1, tags: [] } })).toThrow();
    expect(() => validateRenderPolicy({ version: 1, routeId: "a", mode: "hybrid",
      cache: { scope: "public", ttlSeconds: 30, staleWhileRevalidateSeconds: 10, tags: [] } })).toThrow();
    expect(() => safeLocation("//other.test/", "https://shop.example.test")).toThrow();
    expect(() => safeLocation("javascript:alert(1)", "https://shop.example.test")).toThrow();
    expect(safeLocation("/products/1", "https://shop.example.test")).toBe("/products/1");
  });
});
