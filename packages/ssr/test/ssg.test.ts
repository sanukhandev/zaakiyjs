import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, mkdir, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prerenderStatic } from "../src/ssg.js";
import type { ServerOptions } from "../src/node.js";

const manifest = { schema: "zaakiy.render-manifest/1", buildId: "a".repeat(64),
  irVersion: 1, domAbiVersion: 1, routes: {
    product: { moduleId: "compiled/product", sourceDigest: "b".repeat(64), routeId: "product" }
  } } as const;
const server: ServerOptions = {
  origin: "https://shop.example.test",
  routes: [{ id: "product", path: "/products/:slug" }, { id: "private", path: "/account" }],
  policies: [
    { version: 1, routeId: "product", mode: "ssg",
      cache: { scope: "public", ttlSeconds: 60, tags: ["product:all"] } },
    { version: 1, routeId: "private", mode: "csr" }
  ],
  manifest, modules: { "compiled/product": { sourceDigest: "b".repeat(64), module: {
    protocol: "zaakiy.render/1",
    render: ctx => ({ version: 1, status: 200, headers: {},
      body: "<p>" + ctx.route.params.slug + "</p>", cache: { scope: "public", tags: ["product:all"] } })
  } } }
};
describe("bounded deterministic public SSG", () => {
  it("prerenders safe discovered public paths with stable hashes and manifest", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zaakiy-ssg-"));
    try {
      const run = () => prerenderStatic({ server, outDir: dir, paths: ["/products/a"],
        discover: async () => ["/products/b"], assets: { "/app.js": "/assets/app-123.js" } });
      const first = await run();
      const second = await run();
      expect(first.outputs).toEqual(second.outputs);
      expect(first.outputs.map(x => x.path)).toEqual(["/products/a", "/products/b"]);
      expect(await readFile(join(dir, "products/a/index.html"), "utf8")).toBe("<p>a</p>");
      const output = JSON.parse(await readFile(join(dir, "prerender-manifest.json"), "utf8"));
      expect(output.buildId).toBe("a".repeat(64));
      expect(output.routes).toHaveLength(2);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it("rejects existing symlinks that redirect static files outside the output root", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zaakiy-ssg-"));
    const outside = await mkdtemp(join(tmpdir(), "zaakiy-ssg-escape-"));
    try {
      await mkdir(join(outside, "a"), { recursive: true });
      await symlink(outside, join(dir, "products"), "dir");
      await expect(prerenderStatic({ server, outDir: dir, paths: ["/products/a"] }))
        .rejects.toThrow();
      await expect(readFile(join(outside, "a/index.html"), "utf8")).rejects.toThrow();
    } finally {
      await rm(dir, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });
  it("rejects private, duplicate, traversal and unbounded routes", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zaakiy-ssg-"));
    try {
      for (const paths of [["/account"], ["/products/a", "/products/a"], ["/products/../secrets"],
        ["/products/%2e%2e"], ["//evil/path"], ["/products/a", "/products/b"]]) {
        await expect(prerenderStatic({ server, outDir: dir, paths,
          ...(paths.length === 2 && paths[1] === "/products/b" ? { maxRoutes: 1 } : {}) })).rejects.toThrow();
      }
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});
