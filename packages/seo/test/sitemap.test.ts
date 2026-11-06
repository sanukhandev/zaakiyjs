import { describe, expect, it } from "vitest";
import { auditHreflang, generateRobotsTxt, generateSitemapIndex, generateSitemaps,
  planSitemapRebuild } from "../src/index.js";
const policy = { siteURL: "https://example.com" };
describe("robots/sitemap", () => {
  it("generates safe robots directives and sitemap URLs", () => {
    const result = generateRobotsTxt({ ...policy, groups: [{ agents: ["*"], disallow: ["/private"] }], sitemaps: ["/sitemap.xml"] });
    expect(result).toContain("Disallow: /private");
    expect(result).toContain("Sitemap: https://example.com/sitemap.xml");
    expect(() => generateRobotsTxt({ ...policy, groups: [{ agents: ["*\nDisallow: /"] }] })).toThrow();
  });
  it("excludes unpublished, private, unauthorized, noindex, redirects, errors and soft404s", async () => {
    const inputs = [{ loc: "/public" }, { loc: "/private", private: true },
      { loc: "/draft", published: false }, { loc: "/auth", authorized: false },
      { loc: "/noindex", noindex: true }, { loc: "/redirect", redirect: true },
      { loc: "/soft404", soft404: true }, { loc: "/404", status: 404 }];
    const result = await generateSitemaps(inputs, policy);
    expect(result.excluded).toBe(7);
    expect(result.files[0]?.count).toBe(1);
    expect(result.files[0]?.xml).not.toContain("/private");
  });
  it("escapes XML for query and alternates; hashes are order invariant", async () => {
    const input = [{ loc: "/b" }, { loc: "/a?x=1&y=2", lastmod: "2026-11-01", alternates: { en: "/en", fr: "/fr" } }];
    const a = await generateSitemaps(input, policy);
    const b = await generateSitemaps([...input].reverse(), policy);
    expect(a).toEqual(b);
    expect(a.files[0]?.xml).toContain("x=1&amp;y=2");
    expect(a.files[0]?.xml).toContain("xmlns:xhtml=");
    expect(a.files[0]?.xml).toContain("<lastmod>2026-11-01</lastmod>");
  });
  it("splits and builds an index without generating fake lastmod", async () => {
    const inputs = Array.from({ length: 5 }, (_, i) => ({ loc: "/page/" + i }));
    const build = await generateSitemaps(inputs, { ...policy, maxEntries: 2 });
    expect(build.files.map(f => f.count)).toEqual([2, 2, 1]);
    expect(build.index).toContain("sitemap-3.xml");
    expect(build.index).not.toContain("<lastmod>");
  });
  it("supports dynamic async record discovery", async () => {
    async function* pages() { yield { loc: "/a" }; yield { loc: "/b" }; }
    expect((await generateSitemaps(pages(), policy)).files[0]?.count).toBe(2);
  });
  it("rejects invalid lastmod, foreign links and excessive protocol limits", async () => {
    await expect(generateSitemaps([{ loc: "/a", lastmod: "today" }], policy)).rejects.toThrow();
    await expect(generateSitemaps([{ loc: "https://evil.test/a" }], policy)).rejects.toThrow();
    await expect(generateSitemaps([{ loc: "/a" }], { ...policy, maxEntries: 50001 })).rejects.toThrow();
    expect(() => generateSitemapIndex([{ loc: "/sitemap.xml", lastmod: "now" }], policy)).toThrow();
  });
  it("rejects duplicate index entry and escapes XML", () => {
    expect(() => generateSitemapIndex([{ loc: "/a" }, { loc: "/a" }], policy)).toThrow();
    expect(generateSitemapIndex([{ loc: "/a?a=1&b=2" }], policy)).toContain("a=1&amp;b=2");
  });
  it("plans deterministic incremental rebuild and checks reciprocal hreflang", () => {
    expect(planSitemapRebuild({ a: "old", b: "same" }, { a: "new", c: "new" }))
      .toEqual({ changed: ["a", "c"], removed: ["b"] });
    const issues = auditHreflang([
      { loc: "/en", alternates: { fr: "/fr", en: "/en" } },
      { loc: "/fr", alternates: { fr: "/fr" } }
    ], policy);
    expect(issues.some(x => x.code === "SEO202")).toBe(true);
  });
});
