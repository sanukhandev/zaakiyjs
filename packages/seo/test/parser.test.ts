// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { generateSitemaps, renderMetadata } from "../src/index.js";
describe("parser-based SEO output validation", () => {
  it("emits parseable HTML metadata with one canonical and safe JSON-LD", () => {
    const result = renderMetadata({
      title: "Demo <Product>", canonical: "/a?x=1&y=2",
      structuredData: { "@type": "Product", name: "</script><img onerror=alert(1)>" }
    }, { siteURL: "https://example.com" });
    const doc = new DOMParser().parseFromString("<!doctype html><html><head>" +
      result.html + "</head><body></body></html>", "text/html");
    expect(doc.querySelectorAll('link[rel="canonical"]')).toHaveLength(1);
    expect(doc.title).toBe("Demo <Product>");
    const json = doc.querySelector('script[type="application/ld+json"]')?.textContent;
    expect(json).toBeDefined();
    expect(JSON.parse(json!).name).toBe("</script><img onerror=alert(1)>");
    expect(doc.querySelectorAll("img")).toHaveLength(0);
  });
  it("emits XML parsed by a namespace-aware document parser", async () => {
    const output = await generateSitemaps([{ loc: "/a?x=1&y=2",
      alternates: { en: "/a", fr: "/fr" } }], { siteURL: "https://example.com" });
    const doc = new DOMParser().parseFromString(output.files[0]!.xml, "application/xml");
    expect(doc.querySelector("parsererror")).toBeNull();
    expect(doc.getElementsByTagNameNS("http://www.sitemaps.org/schemas/sitemap/0.9", "loc")).toHaveLength(1);
    expect(doc.getElementsByTagNameNS("http://www.w3.org/1999/xhtml", "link")).toHaveLength(2);
  });
});
