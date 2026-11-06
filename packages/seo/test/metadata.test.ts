import { describe, expect, it } from "vitest";
import { auditMetadata, defineMetadata, definePageMetadata, normalizeCanonical,
  renderMetadata, resolveMetadata, resolveRouteMetadata, serializeJsonLd, validateStructuredData } from "../src/index.js";
const policy = { siteURL: "https://example.com", trailingSlash: "never" as const };
describe("metadata/canonical", () => {
  it("merges defaults, route precedence and social tags", () => {
    const result = renderMetadata([
      defineMetadata({ title: "Default", description: "Description", openGraph: { title: "Base", image: "/preview.png" } }),
      { title: "Product", canonical: "/products/a/", openGraph: { title: "Specific" } }
    ], policy);
    expect(result.metadata.canonical).toBe("https://example.com/products/a");
    expect(result.metadata.openGraph?.image).toBe("https://example.com/preview.png");
    expect(result.html).toContain('property="og:title" content="Specific"');
  });
  it("resolves typed loader data, route lineage and params", () => {
    const resolver = definePageMetadata<{ title: string }, { slug: string }>(({ data, params }) => ({
      title: data.title, canonical: "/products/" + encodeURIComponent(params.slug)
    }));
    const result = resolveRouteMetadata("p", [
      { id: "root", metadata: { author: "Zaakiy" } },
      { id: "p", parentId: "root", metadata: resolver }
    ], { description: "Root" }, { ...policy, data: { title: "Demo" }, params: { slug: "a b" } });
    expect(result).toMatchObject({ title: "Demo", description: "Root", author: "Zaakiy" });
    expect(result.canonical).toContain("a%20b");
  });
  it("rejects circular route metadata configs", () => {
    expect(() => resolveRouteMetadata("a", [{ id: "a", parentId: "a" }], {}, policy)).toThrow("Circular");
  });
  it("forces noindex private/error metadata without allowing an override", () => {
    for (const status of [404, 410, 500]) {
      const resolved = resolveMetadata([{ robots: { index: true, follow: true } }],
        { ...policy, status });
      expect(resolved.robots).toMatchObject({ index: false, follow: false });
      expect(renderMetadata([{ robots: { index: true } }], { ...policy, status }).headers["X-Robots-Tag"]).toContain("noindex");
    }
    expect(resolveMetadata([{ robots: { index: true } }], { ...policy, private: true }).robots.index).toBe(false);
  });
  it("escapes malicious head text and produces exactly one canonical", () => {
    const result = renderMetadata([{ title: "A", canonical: "/a" },
      { title: "<script>", canonical: "/b", description: 'A & "B"' }], policy);
    expect(result.html).toContain("&lt;script&gt;");
    expect(result.html).toContain('A &amp; &quot;B&quot;');
    expect(result.html.match(/rel="canonical"/g)).toHaveLength(1);
  });
  it("preserves meaningful query by default and supports allowlist", () => {
    expect(normalizeCanonical("/list?page=2", policy)).toContain("?page=2");
    expect(normalizeCanonical("/list?ref=a&page=2", { ...policy, query: { allow: ["page"] } })).toContain("?page=2");
    expect(normalizeCanonical("/list?page=2", { ...policy, query: "strip" })).toBe("https://example.com/list");
  });
  it("rejects foreign canonical, credentials, protocol-relative, unsafe and malformed URL", () => {
    for (const url of ["javascript:alert(1)", "data:a", "//evil.com/a", "https://evil.com/",
      "https://user:pass@example.com", "/invalid%XY", "/a\\b"]) {
      expect(() => normalizeCanonical(url, policy)).toThrow();
    }
    expect(normalizeCanonical("https://cdn.example.com/image", {
      ...policy, allowedOrigins: ["https://cdn.example.com"]
    })).toBe("https://cdn.example.com/image");
  });
  it("supports robots, Twitter and locale alternate tags", () => {
    const result = renderMetadata({
      title: "Product", canonical: "/en", robots: { index: false, noarchive: true },
      twitter: { card: "summary_large_image" }, alternates: { fr: "/fr", "x-default": "/" }
    }, policy);
    expect(result.html).toContain('name="twitter:card"');
    expect(result.html).toContain('hreflang="fr"');
    expect(result.headers["X-Robots-Tag"]).toContain("noarchive");
  });
});
describe("JSON-LD/security/diagnostics", () => {
  it("escapes script terminators and still round-trips", () => {
    const text = "</script><img src=x onerror=alert(1)>&";
    const serialized = serializeJsonLd({ "@type": "Product", name: text });
    expect(serialized).not.toContain("<");
    expect(serialized).toContain("\\u003c");
    expect(serialized).toContain("\\u0026");
    expect(JSON.parse(serialized).name).toBe(text);
  });
  it("validates required fields, finite numbers and circular structures", () => {
    expect(() => validateStructuredData({ "@type": "Product" })).toThrow("name");
    expect(() => validateStructuredData({ "@type": "Product", name: "A", price: Infinity })).toThrow("Unsupported");
    const item: { "@type": string; name: string; child?: unknown } = { "@type": "Product", name: "X" };
    item.child = item;
    expect(() => validateStructuredData(item)).toThrow("Circular");
  });
  it("returns severity-tiered diagnostics without inventing schema claims", () => {
    const result = resolveMetadata([{ title: "", structuredData: { "@type": "Product", name: "Demo" } }], policy);
    const diagnostics = auditMetadata(result);
    expect(diagnostics.some(d => d.code === "SEO001" && d.severity === "error")).toBe(true);
    expect(diagnostics.some(d => d.code === "SEO008" && d.severity === "info")).toBe(true);
    expect(renderMetadata(result, policy).html).not.toContain("ratingValue");
  });
  it("reports duplicate canonicals and noindex sitemap exposure", () => {
    const result = resolveMetadata([{ title: "A", robots: { index: false } }], policy);
    const tags = [
      { kind: "link" as const, key: "a", attributes: { rel: "canonical", href: "/a" } },
      { kind: "link" as const, key: "b", attributes: { rel: "canonical", href: "/b" } }
    ];
    const codes = auditMetadata(result, { existingTags: tags, sitemapIncluded: true }).map(d => d.code);
    expect(codes).toContain("SEO009");
    expect(codes).toContain("SEO007");
  });
});
