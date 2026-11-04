import { afterEach, describe, expect, it, vi } from "vitest";
import { build, createServer, type ViteDevServer, type RollupOutput } from "vite";
import { fileURLToPath } from "node:url";
import { hasCompiler, hasStyles } from "../src/bridge.js";
import { zaakiyPlugin } from "../src/plugin.js";

const fixtureRoot = fileURLToPath(new URL("./fixtures/basic/", import.meta.url));
const brandRoot = fileURLToPath(new URL("./fixtures/bad-brand/", import.meta.url));
const plainRoot = fileURLToPath(new URL("./fixtures/plain/", import.meta.url));
const forbiddenRoot = fileURLToPath(new URL("./fixtures/forbidden/", import.meta.url));
let server: ViteDevServer | undefined;

afterEach(async () => {
  if (server) {
    await server.close();
    server = undefined;
  }
});

describe("real Vite integration (M0 prerequisite checks)", () => {
  it("starts an actual development server without compiling unrelated JavaScript", async () => {
    server = await createServer({
      configFile: false,
      root: fixtureRoot,
      plugins: [zaakiyPlugin()],
      server: { middlewareMode: true, hmr: false }
    });
    expect(server.moduleGraph).toBeDefined();
    expect(await server.transformRequest("/src/ordinary.js")).toMatchObject({
      code: expect.stringContaining("not compiled by Zaakiy")
    });
  });

  it("fails unsupported SSR TSX transforms rather than delegating to a different JSX runtime", async () => {
    server = await createServer({
      configFile: false,
      root: fixtureRoot,
      plugins: [zaakiyPlugin()],
      server: { middlewareMode: true, hmr: false }
    });
    await expect(server.transformRequest("/src/main.tsx", { ssr: true })).rejects.toThrow("ZV1008");
  });

  it("builds a non-TSX entry through Vite, emits CSS/manifest, and links stylesheet in HTML", async () => {
    const result = await build({
      configFile: false,
      root: plainRoot,
      plugins: [zaakiyPlugin({ cssFileName: "assets/theme.css" })],
      logLevel: "silent",
      build: { write: false, emptyOutDir: false }
    });
    const output = Array.isArray(result) ? result[0] : result;
    expect(output).toBeDefined();
    const assets = (output as RollupOutput).output.filter(e => e.type === "asset");
    const css = assets.find(e => e.fileName === "assets/theme.css");
    expect(css?.source).toBe("");
    const html = assets.find(e => e.fileName === "index.html");
    expect(String(html?.source)).toContain('href="/assets/theme.css"');
    const manifest = assets.find(e => e.fileName === "zaakiy-assets.json");
    expect(manifest).toBeDefined();
    const parsed = JSON.parse(String(manifest?.source)) as { schemaVersion: number; assets: { fileName: string }[] };
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.assets.map(a => a.fileName)).toContain("assets/theme.css");
    expect(parsed.assets.filter(a => a.fileName.endsWith(".js")).length).toBeGreaterThanOrEqual(2);
  });

  it("uses Vite's actual watcher to trigger a full reload for changed TSX, never silent owner reuse", async () => {
    server = await createServer({
      configFile: false,
      root: fixtureRoot,
      plugins: [zaakiyPlugin()],
      server: { middlewareMode: true }
    });
    const socketSpy = vi.spyOn(server.ws, "send");
    const changed = fileURLToPath(new URL("./fixtures/basic/src/main.tsx", import.meta.url));
    server.watcher.emit("change", changed);
    await vi.waitFor(() => {
      expect(socketSpy).toHaveBeenCalledWith({ type: "full-reload", path: "*" });
    }, { timeout: 3000, interval: 50 });
  });

  it("rejects a forbidden build-time import from a plain JavaScript browser entry", async () => {
    await expect(build({
      configFile: false,
      root: forbiddenRoot,
      plugins: [zaakiyPlugin()],
      logLevel: "silent",
      build: { write: false, emptyOutDir: false }
    })).rejects.toThrow("ZV3001");
  });

  it("produces identical asset names and contents for repeated pinned Vite inputs", async () => {
    const compile = async (): Promise<readonly { fileName: string; body: string }[]> => {
      const built = await build({
        configFile: false,
        root: plainRoot,
        plugins: [zaakiyPlugin()],
        logLevel: "silent",
        build: { write: false, emptyOutDir: false }
      });
      const result = Array.isArray(built) ? built[0] : built;
      return (result as RollupOutput).output.map((item) => ({
        fileName: item.fileName,
        body: item.type === "chunk" ? item.code : String(item.source)
      })).sort((a, b) => a.fileName.localeCompare(b.fileName));
    };
    const first = await compile();
    expect(first.length).toBeGreaterThanOrEqual(4);
    expect(await compile()).toEqual(first);
  });

  it("does not silently fall back to another JSX transform when compiler is missing", async () => {
    if (hasCompiler()) return;
    server = await createServer({
      configFile: false,
      root: fixtureRoot,
      plugins: [zaakiyPlugin()],
      server: { middlewareMode: true, hmr: false }
    });
    await expect(server.transformRequest("/src/main.tsx")).rejects.toThrow("ZV1001");
  });

  it("rejects an executable production build until the real compiler exists", async () => {
    if (hasCompiler()) return;
    await expect(build({
      configFile: false,
      root: fixtureRoot,
      plugins: [zaakiyPlugin()],
      logLevel: "silent",
      build: { write: false, emptyOutDir: false }
    })).rejects.toThrow("ZV1001");
  });

  it("reports brand configuration errors rather than swallowing them", async () => {
    await expect(createServer({
      configFile: false,
      root: brandRoot,
      plugins: [zaakiyPlugin({ configFile: "zaakiy.config.ts" })],
      logLevel: "silent",
      server: { middlewareMode: true, hmr: false }
    })).rejects.toThrow("ZV2006");
  });

  it.skipIf(!hasCompiler() || !hasStyles())(
    "compiles the real TSX fixture and CSS once compiler/styles implementations are integrated",
    async () => {
      const result = await build({
        configFile: false,
        root: fixtureRoot,
        plugins: [zaakiyPlugin()],
        logLevel: "silent",
        build: { write: false, emptyOutDir: false, sourcemap: true }
      });
      expect(result).toBeDefined();
      const output = Array.isArray(result) ? result[0] : result;
      const assets = (output as RollupOutput).output;
      const js = assets.filter(item => item.type === "chunk");
      const css = assets.find(item => item.type === "asset" && item.fileName === "assets/zaakiy-styles.css");
      const manifest = assets.find(item => item.type === "asset" && item.fileName === "zaakiy-assets.json");
      expect(js.length).toBeGreaterThan(0);
      expect(css).toBeDefined();
      expect(String(css?.source)).toContain("flex");
      expect(manifest).toBeDefined();
      expect(js.every(chunk => !/@zaakiyjs\/(?:ai|proxy|compiler|styles|vite-plugin)/.test(chunk.type === "chunk" ? chunk.code : ""))).toBe(true);
    }
  );
});
