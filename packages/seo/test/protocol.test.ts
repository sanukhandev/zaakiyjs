import { describe, expect, it, vi } from "vitest";
import { auditSeoV1, createSeoHeadAdapterV1, generateSitemapsFromFeedV1, resolveSeoV1,
  seoRobotsHeaderV1, seoToRenderHeadV1 } from "../src/index.js";
import type { SeoDocumentV1, SeoResolveInputV1, SitemapFeedV1 } from "../src/index.js";
const siteOrigin = new URL("https://shop.example.test");
const productInput: SeoResolveInputV1<{ name: string }> = {
  routeId: "product",
  url: new URL("https://shop.example.test/products/sku-7"),
  params: { slug: "sku-7" },
  loaderData: { name: "Safe Lamp" },
  status: 200, visibility: "public", siteOrigin
};
const productFactory = (input: SeoResolveInputV1<{ name: string }>): SeoDocumentV1 => ({
  version: 1, title: input.loaderData.name, canonical: "/products/" + input.params.slug,
  openGraph: { type: "product", title: input.loaderData.name, images: [
    { url: "/img.png", alt: "Lamp" }, { url: "/img.png", alt: "Duplicate" }
  ] }, jsonLd: [{ "@type": "Product", name: input.loaderData.name }]
});
describe("frozen P3 SEO v1", () => {
  it("uses one authorized loader snapshot for metadata and safe SSR head entries", async () => {
    const resolution = await resolveSeoV1(productInput, productFactory, {
      defaults: { version: 1, description: "Catalogue" }
    });
    expect(resolution.version).toBe(1);
    expect(resolution.metadata).toMatchObject({
      title: "Safe Lamp", description: "Catalogue",
      canonical: "https://shop.example.test/products/sku-7"
    });
    expect(resolution.metadata.openGraph?.images).toHaveLength(1);
    const entries = seoToRenderHeadV1(resolution);
    expect(entries.find(e => e.tag === "title")?.text).toBe("Safe Lamp");
    expect(entries.find(e => e.tag === "script-jsonld")?.text).toContain("Safe Lamp");
  });
  it("enforces 404/410, private/draft noindex and strips sensitive structured data", async () => {
    for (const input of [
      { ...productInput, status: 404 },
      { ...productInput, status: 410 },
      { ...productInput, status: 204 },
      { ...productInput, status: 304 },
      { ...productInput, status: 401, visibility: "private" as const },
      { ...productInput, status: 200, visibility: "draft" as const }
    ]) {
      const result = await resolveSeoV1(input, productFactory);
      expect(result.metadata.jsonLd).toBeUndefined();
      expect(result.metadata.canonical).toBeUndefined();
      expect(result.metadata.robots).toMatchObject({ index: false, follow: false });
      expect(seoRobotsHeaderV1(result.metadata)).toContain("noindex");
    }
  });
  it("never evaluates SEO factories for missing, deleted or private loader data", async () => {
    const forbidden = vi.fn((): SeoDocumentV1 => {
      throw new Error("Factory must not read missing or private loader data");
    });
    for (const input of [
      { ...productInput, status: 404, loaderData: undefined },
      { ...productInput, status: 410, loaderData: undefined },
      { ...productInput, status: 200, visibility: "private" as const },
      { ...productInput, status: 200, visibility: "draft" as const }
    ]) {
      const result = await resolveSeoV1(input, forbidden);
      expect(result.metadata.robots?.index).toBe(false);
      expect(result.metadata.jsonLd).toBeUndefined();
    }
    expect(forbidden).not.toHaveBeenCalled();
  });
  it("validates redirect Location and removes indexable response content", async () => {
    const result = await resolveSeoV1({ ...productInput, status: 302 }, productFactory,
      { redirect: { status: 302, location: "/new" } });
    expect(result.redirect?.location).toBe("https://shop.example.test/new");
    expect(result.metadata.title).toBeUndefined();
    expect(result.metadata.robots?.index).toBe(false);
    await expect(resolveSeoV1({ ...productInput, status: 302 }, productFactory)).rejects.toThrow("Redirect");
    await expect(resolveSeoV1({ ...productInput, status: 302 }, productFactory,
      { redirect: { status: 302, location: "https://evil.test" } })).rejects.toThrow();
  });
  it("preserves redirect query, fragment and trailing slash regardless of canonical policy", async () => {
    const output = await resolveSeoV1({ ...productInput, status: 302 }, productFactory, {
      query: "strip", trailingSlash: "never",
      redirect: { status: 302, location: "/new/?item=7&lang=en#details" }
    });
    expect(output.redirect?.location).toBe("https://shop.example.test/new/?item=7&lang=en#details");
    const approved = await resolveSeoV1({ ...productInput, status: 307 }, productFactory, {
      allowedOrigins: ["https://checkout.example.test"],
      query: "strip",
      redirect: { status: 307, location: "https://checkout.example.test/start?token=abc#step2" }
    });
    expect(approved.redirect?.location).toBe("https://checkout.example.test/start?token=abc#step2");
    for (const location of ["javascript:alert(1)", "//evil.example.test/start",
      "https://user:password@shop.example.test/start", "/bad%GG"]) {
      await expect(resolveSeoV1({ ...productInput, status: 302 }, productFactory,
        { redirect: { status: 302, location } })).rejects.toThrow();
    }
  });
  it("rejects untrusted origins, bad versions and malicious JSON-LD", async () => {
    await expect(resolveSeoV1({ ...productInput, siteOrigin: new URL("http://shop.example.test") },
      productFactory)).rejects.toThrow("HTTPS");
    await expect(resolveSeoV1(productInput, () => ({
      version: 9, title: "Wrong"
    } as unknown as SeoDocumentV1))).rejects.toThrow("Expected");
    await expect(resolveSeoV1(productInput, () => ({
      version: 1, jsonLd: [{ "@type": "Product", name: "X", "@context": "http://evil.test" }]
    }))).rejects.toThrow("@context");
    const encoded = seoToRenderHeadV1(await resolveSeoV1(productInput, () => ({
      version: 1, jsonLd: [{ "@type": "Product", name: "</script><img src=x>" }]
    }))).find(e => e.tag === "script-jsonld")?.text;
    expect(encoded).not.toContain("<");
  });
  it("normalizes locale alternates and rejects conflicting locale URL", async () => {
    const output = await resolveSeoV1(productInput, () => ({
      version: 1, locale: "en-US", alternates: [
        { hreflang: "en", url: "/en" }, { hreflang: "fr", url: "/fr" },
        { hreflang: "en", url: "/en" }, { hreflang: "x-default", url: "/" }
      ]
    }));
    expect(output.metadata.alternates).toHaveLength(3);
    await expect(resolveSeoV1(productInput, () => ({ version: 1, alternates: [
      { hreflang: "en", url: "/en" }, { hreflang: "en", url: "/other" }
    ] }))).rejects.toThrow("Conflicting");
  });
  it("provides a public structural head adapter without SSR/Router imports", async () => {
    const adapter = createSeoHeadAdapterV1({
      siteOrigin, routes: [{ routeId: "product", visibility: "public",
        params: { slug: "sku-7" }, factory: productFactory as (input: SeoResolveInputV1) => SeoDocumentV1 }]
    });
    expect(adapter.version).toBe(1);
    const tags = await adapter.resolve({ routeId: "product",
      url: productInput.url, status: 200, loaderData: productInput.loaderData });
    expect(tags.find(t => t.tag === "link" && t.attributes?.rel === "canonical")?.attributes?.href)
      .toBe("https://shop.example.test/products/sku-7");
  });
  it("returns machine-readable SEO diagnostics for private or invalid indexability", async () => {
    const product = await resolveSeoV1(productInput, productFactory);
    const good = auditSeoV1({ resolution: product, visibility: "public" });
    expect(good.some(d => d.severity === "error")).toBe(false);
    const missing = await resolveSeoV1({ ...productInput, status: 404 }, productFactory);
    const bad = auditSeoV1({ resolution: missing, visibility: "public", sitemapIncluded: true });
    expect(bad).toContainEqual(expect.objectContaining({
      code: "SEO307", severity: "error"
    }));
    const duplicates = auditSeoV1({ resolution: product, visibility: "public", existingCanonicalCount: 2 });
    expect(duplicates.some(d => d.code === "SEO308")).toBe(true);
  });
  it("reads fresh route params from an application-supplied adapter for dynamic URLs", async () => {
    const adapter = createSeoHeadAdapterV1({
      siteOrigin,
      routes: [{
        routeId: "product", visibility: "public",
        resolveParams: ({ url }: { url: URL }) => ({ slug: url.pathname.split("/").at(-1)! }),
        factory: productFactory as (input: SeoResolveInputV1) => SeoDocumentV1
      }]
    });
    const tags = await adapter.resolve({
      routeId: "product", url: new URL("https://shop.example.test/products/other"),
      loaderData: { name: "Another Lamp" }, status: 200
    });
    expect(tags.find(t => t.tag === "link" && t.attributes?.rel === "canonical")?.attributes?.href)
      .toBe("https://shop.example.test/products/other");
  });
  it("supports bounded cursor-based published sitemap feeds and abort", async () => {
    const feed: SitemapFeedV1 = {
      schema: "zaakiy.sitemap/1",
      async entries({ cursor }) {
        return cursor ? { items: [{ loc: "https://shop.example.test/b", visibility: "public" as const }] }
          : { items: [{ loc: "https://shop.example.test/a", lastmod: "2026-11-01", visibility: "public" as const }],
              nextCursor: "page2" };
      }
    };
    const invalidFeed = {
      schema: "zaakiy.sitemap/1" as const,
      async entries() {
        return { items: [{ loc: "/relative-not-allowed", visibility: "public" as const }] };
      }
    };
    await expect(generateSitemapsFromFeedV1(invalidFeed, new AbortController().signal,
      { siteURL: siteOrigin.href })).rejects.toThrow("absolute HTTPS");
    await expect(generateSitemapsFromFeedV1(feed, new AbortController().signal,
      { siteURL: "http://shop.example.test" })).rejects.toThrow("HTTPS origin");
    const generated = await generateSitemapsFromFeedV1(feed, new AbortController().signal,
      { siteURL: siteOrigin.href });
    expect(generated.files[0]?.count).toBe(2);
    const controller = new AbortController();
    controller.abort();
    await expect(generateSitemapsFromFeedV1(feed, controller.signal,
      { siteURL: siteOrigin.href })).rejects.toBeDefined();
  });
});
