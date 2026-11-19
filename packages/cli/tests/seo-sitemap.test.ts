import {afterEach, describe, expect, it} from "vitest";
import {mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {runCli} from "../src/index.js";

const roots: string[] = [];
async function project(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "zaakiy-sitemap-"));
  roots.push(root);
  await writeFile(join(root, "package.json"), JSON.stringify({
    name: "sitemap-fixture",
    dependencies: {"@zaakiyjs/core": "workspace:^"}
  }));
  return root;
}
afterEach(async () => {
  for (const path of roots.splice(0)) await rm(path, {recursive: true, force: true});
});
function capture(root: string) {
  let stdout = "", stderr = "";
  return {
    io: {cwd: root, stdout: (value: string) => {stdout += value;},
      stderr: (value: string) => {stderr += value;}},
    get stdout() {return stdout;},
    get stderr() {return stderr;}
  };
}

describe("CLI sitemap generation", () => {
  it("uses the SEO engine and excludes private, draft, noindex and error records", async () => {
    const root = await project();
    const feed = {
      schema: "zaakiy.sitemap-input/1",
      siteURL: "https://example.com",
      maxEntries: 1,
      entries: [
        {loc: "/b", visibility: "public", lastmod: "2026-11-18"},
        {loc: "/a", visibility: "public"},
        {loc: "/private", visibility: "private"},
        {loc: "/draft", visibility: "draft"},
        {loc: "/robots", noindex: true},
        {loc: "/gone", status: 404},
        {loc: "/a", visibility: "public"}
      ]
    };
    await writeFile(join(root, "feed.json"), JSON.stringify(feed));
    const preview = capture(root);
    expect(await runCli(["seo", "sitemap", "feed.json", "--dry-run", "--json"], preview.io)).toBe(0);
    expect(JSON.parse(preview.stdout)).toMatchObject({
      schemaVersion: 1, dryRun: true, included: 2, excluded: 5
    });
    await expect(stat(join(root, "public"))).rejects.toThrow();
    const run = capture(root);
    expect(await runCli(["seo", "sitemap", "feed.json", "--json"], run.io)).toBe(0);
    const report = JSON.parse(run.stdout) as {files: string[]};
    expect(report.files).toEqual([
      "public/sitemap-1.xml", "public/sitemap-2.xml", "public/sitemap-index.xml"
    ]);
    const first = await readFile(join(root, "public/sitemap-1.xml"), "utf8");
    const second = await readFile(join(root, "public/sitemap-2.xml"), "utf8");
    const index = await readFile(join(root, "public/sitemap-index.xml"), "utf8");
    expect(first).toContain("https://example.com/a");
    expect(second).toContain("https://example.com/b");
    expect(first + second).not.toMatch(/private|draft|robots|gone/);
    expect(index).toContain("https://example.com/sitemap-1.xml");
    expect(index).toContain("https://example.com/sitemap-2.xml");
    expect(await runCli(["seo", "sitemap", "feed.json", "--json"], capture(root).io)).toBe(0);
    const repeated = capture(root);
    expect(await runCli(["seo", "sitemap", "feed.json", "--json"], repeated.io)).toBe(0);
    expect(JSON.parse(repeated.stdout).files).toEqual([]);
    expect(await readFile(join(root, "public/sitemap-1.xml"), "utf8")).toBe(first);
  });

  it("rejects invalid, malicious and conflicting input without writing output", async () => {
    const root = await project();
    for (const input of [
      {schema: "wrong", siteURL: "https://example.com", entries: []},
      {schema: "zaakiy.sitemap-input/1", siteURL: "http://example.com", entries: []},
      {schema: "zaakiy.sitemap-input/1", siteURL: "https://example.com",
        entries: [{loc: "javascript:alert(1)"}]},
      {schema: "zaakiy.sitemap-input/1", siteURL: "https://example.com",
        entries: [{loc: "https://evil.example/x"}]},
      {schema: "zaakiy.sitemap-input/1", siteURL: "https://example.com",
        entries: [{loc: "/a", lastmod: "2026-02-30"}]},
      {schema: "zaakiy.sitemap-input/1", siteURL: "https://example.com",
        entries: [{loc: "/a"}, {loc: "/a", priority: 0.5}]},
      {schema: "zaakiy.sitemap-input/1", siteURL: "https://example.com",
        entries: [{loc: "/secret", private: "false"}]}
    ]) {
      await writeFile(join(root, "invalid.json"), JSON.stringify(input));
      const run = capture(root);
      expect(await runCli(["seo", "sitemap", "invalid.json"], run.io)).toBe(1);
      expect(run.stderr).toContain("SEO_SITEMAP_INPUT");
      await expect(stat(join(root, "public"))).rejects.toThrow();
    }
    const traversal = capture(root);
    expect(await runCli(["seo", "sitemap", "../secret.json"], traversal.io)).toBe(1);
    expect(traversal.stderr).toContain("UNSAFE_PATH");
  });

  it("refuses symlink input/output, preserves collisions and supports explicit force", async () => {
    const root = await project();
    const external = await project();
    const feed = {schema: "zaakiy.sitemap-input/1", siteURL: "https://example.com",
      entries: [{loc: "/one"}]};
    await writeFile(join(external, "pages.json"), JSON.stringify(feed));
    await symlink(join(external, "pages.json"), join(root, "linked.json"));
    const linked = capture(root);
    expect(await runCli(["seo", "sitemap", "linked.json"], linked.io)).toBe(1);
    expect(linked.stderr).toContain("SEO_SITEMAP_INPUT");

    await writeFile(join(root, "pages.json"), JSON.stringify(feed));
    await mkdir(join(root, "public"));
    await writeFile(join(root, "public/sitemap.xml"), "user content");
    const collision = capture(root);
    expect(await runCli(["seo", "sitemap", "pages.json"], collision.io)).toBe(1);
    expect(collision.stderr).toContain("FILE_EXISTS");
    expect(await readFile(join(root, "public/sitemap.xml"), "utf8")).toBe("user content");

    expect(await runCli(["seo", "sitemap", "pages.json", "--force"], capture(root).io)).toBe(0);
    expect(await readFile(join(root, "public/sitemap.xml"), "utf8")).toContain("https://example.com/one");
    await symlink(external, join(root, "redirect"));
    const redirected = capture(root);
    expect(await runCli(["seo", "sitemap", "pages.json", "--path", "redirect", "--force"], redirected.io)).toBe(1);
    expect(redirected.stderr).toContain("SYMLINK_PATH");
    await expect(stat(join(external, "sitemap.xml"))).rejects.toThrow();
  });
});
