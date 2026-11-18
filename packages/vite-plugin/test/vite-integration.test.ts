import { afterEach, describe, expect, it, vi } from "vitest";
import { build, createServer, type ViteDevServer, type RollupOutput } from "vite";
import { fileURLToPath } from "node:url";
import { cpSync, mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { hasCompiler, hasStyles } from "../src/bridge.js";
import { zaakiyPlugin } from "../src/index.js";

const fixtureRoot = fileURLToPath(new URL("./fixtures/basic/", import.meta.url));
const brandRoot = fileURLToPath(new URL("./fixtures/bad-brand/", import.meta.url));
const plainRoot = fileURLToPath(new URL("./fixtures/plain/", import.meta.url));
const forbiddenRoot = fileURLToPath(new URL("./fixtures/forbidden/", import.meta.url));
const brandOnlyRoot = fileURLToPath(new URL("./fixtures/brand-only/", import.meta.url));
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
    const parsed = JSON.parse(String(manifest?.source)) as {
      schemaVersion: number;
      assets: { fileName: string; sourceFile?: string }[];
    };
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.assets.map(a => a.fileName)).toContain("assets/theme.css");
    expect(new Set(parsed.assets.map(a => a.fileName)).size).toBe(parsed.assets.length);
    expect(parsed.assets.filter(a => a.fileName.endsWith(".js")).length).toBeGreaterThanOrEqual(2);
    // HTML entry chunks can have virtual proxy facades. Such IDs must be omitted,
    // rather than inventing an app source path from their generated chunk name.
    expect(parsed.assets.every(a =>
      !a.sourceFile || (!a.sourceFile.startsWith("/") &&
        !a.sourceFile.includes("\\") && !a.sourceFile.includes("../"))
    )).toBe(true);
  });

  it("emits a deterministic source-scoped strict compatibility manifest for supported TSX", async () => {
    const builds: string[] = [];
    for (let i = 0; i < 2; i++) {
      const result = await build({
        configFile: false, root: fixtureRoot, logLevel: "silent",
        plugins: [zaakiyPlugin({compatibility: {mode: "strict", targets: {profile: "modern-2024"}}})],
        build: {write: false, emptyOutDir: false}
      });
      const output = Array.isArray(result) ? result[0] : result;
      const assets = (output as RollupOutput).output;
      const compat = assets.find(item => item.type === "asset" && item.fileName === "compat-manifest.json");
      expect(compat?.type).toBe("asset");
      const content = String(compat?.type === "asset" ? compat.source : "");
      const parsed = JSON.parse(content) as {
        mode: string; transforms: unknown[]; shims: unknown[]; unsupportedFeatures: unknown[];
        detectedFeatures: unknown[]; hash: string;
      };
      expect(parsed.mode).toBe("strict");
      expect(parsed.transforms).toHaveLength(0);
      expect(parsed.shims).toHaveLength(0);
      expect(parsed.unsupportedFeatures).toHaveLength(0);
      expect(parsed.hash).toMatch(/^fnv1a64:[0-9a-f]{16}$/);
      expect(content).not.toContain(fixtureRoot.replaceAll("\\", "/"));
      const main = assets.find(item => item.type === "asset" && item.fileName === "zaakiy-assets.json");
      const manifest = JSON.parse(String(main?.type === "asset" ? main.source : "")) as {
        assets: Array<{fileName: string}>
      };
      expect(manifest.assets.filter(item => item.fileName === "compat-manifest.json")).toHaveLength(1);
      builds.push(content);
    }
    expect(builds[0]).toBe(builds[1]);
  });

  it("rejects unsupported APIs and unapplied syntax transforms in strict production builds", async () => {
    const temp = mkdtempSync(join(dirname(fixtureRoot), ".zaakiy-compat-strict-"));
    cpSync(fixtureRoot, temp, {recursive: true});
    const source = join(temp, "src", "main.tsx");
    const original = readFileSync(source, "utf8");
    try {
      writeFileSync(source, original + "\nconst unsupported = AbortSignal.any([]); void unsupported;\n");
      await expect(build({
        configFile: false, root: temp, logLevel: "silent",
        plugins: [zaakiyPlugin({compatibility: {mode: "strict",
          targets: {browsers: ["firefox >=100"]}}})],
        build: {write: false, emptyOutDir: false}
      })).rejects.toThrow("ZV4003");
      writeFileSync(source, original + "\nlet flag = false; flag ||= true;\n");
      await expect(build({
        configFile: false, root: temp, logLevel: "silent",
        plugins: [zaakiyPlugin({compatibility: {mode: "strict",
          targets: {browsers: ["safari >=13.1"]}}})],
        build: {write: false, emptyOutDir: false}
      })).rejects.toThrow("ZV4004");
    } finally {
      rmSync(temp, {recursive: true, force: true});
    }
  });

  it("checks emitted ordinary JavaScript chunks beyond TSX source files", async () => {
    const temp = mkdtempSync(join(dirname(fixtureRoot), ".zaakiy-compat-output-"));
    cpSync(fixtureRoot, temp, {recursive: true});
    try {
      const html = join(temp, "index.html");
      writeFileSync(html, readFileSync(html, "utf8").replace(
        "</body>", '<script type="module" src="/src/external-feature.js"></script></body>'
      ));
      writeFileSync(join(temp, "src", "external-feature.js"),
        "globalThis.__zaakiyCompatSmoke = AbortSignal.any([]);\n");
      await expect(build({
        configFile: false, root: temp, logLevel: "silent",
        plugins: [zaakiyPlugin({compatibility: {mode: "strict",
          targets: {browsers: ["firefox >=100"]}}})],
        build: {write: false, emptyOutDir: false}
      })).rejects.toThrow("ZV4003");
    } finally {
      rmSync(temp, {recursive: true, force: true});
    }
  });

  it("rejects conflicting legacy target options and invalid compatibility profiles", async () => {
    await expect(build({
      configFile: false, root: plainRoot, logLevel: "silent",
      plugins: [zaakiyPlugin({
        browserTargets: ["chrome >=124"],
        compatibility: {mode: "strict", targets: {profile: "modern-2024"}}
      })],
      build: {write: false, emptyOutDir: false}
    })).rejects.toThrow("ZV4001");
    await expect(build({
      configFile: false, root: plainRoot, logLevel: "silent",
      plugins: [zaakiyPlugin({
        compatibility: {mode: "strict", targets: {browsers: ["chrome latest"]}}
      })],
      build: {write: false, emptyOutDir: false}
    })).rejects.toThrow("ZV4001");
  });

  it("builds opt-in IR v2 style object and still rejects it with default IR v1", async () => {
    const temp = mkdtempSync(join(dirname(fixtureRoot), ".zaakiy-style-ir2-"));
    cpSync(fixtureRoot, temp, {recursive:true});
    const file = join(temp, "src", "main.tsx");
    try {
      const original = readFileSync(file,"utf8");
      writeFileSync(file, original.replace(
        '<button class="flex gap-4"',
        '<button style={{color: clicks.value ? "red" : "blue"}} class="flex gap-4"'
      ));
      await expect(build({
        configFile: false, root: temp, logLevel:"silent", plugins:[zaakiyPlugin()],
        build:{write:false,emptyOutDir:false}
      })).rejects.toThrow();
      const result = await build({
        configFile: false, root: temp, logLevel:"silent",
        plugins:[zaakiyPlugin({styleBindings:true})],
        build:{write:false,emptyOutDir:false}
      });
      const output=Array.isArray(result)?result[0]:result;
      expect((output as RollupOutput).output.some(item=>item.type==="chunk")).toBe(true);
      const assets=(output as RollupOutput).output;
      expect(assets.find(item=>item.type==="asset"&&item.fileName==="zaakiy-assets.json")).toBeDefined();
    } finally {
      rmSync(temp,{recursive:true,force:true});
    }
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

  it("invalidates the brand configuration through Vite's real file watcher", async () => {
    server = await createServer({
      configFile: false,
      root: brandOnlyRoot,
      plugins: [zaakiyPlugin({ configFile: "zaakiy.config.ts" })],
      server: { middlewareMode: true }
    });
    const socketSpy = vi.spyOn(server.ws, "send");
    const config = fileURLToPath(new URL("./fixtures/brand-only/zaakiy.config.ts", import.meta.url));
    server.watcher.emit("change", config);
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

  it("produces the same manifest bytes in two independently located checkouts", async () => {
    const sandbox = mkdtempSync(join(tmpdir(), "zaakiy-vite-manifest-"));
    try {
      const manifests: string[] = [];
      for (const name of ["machine-a", "machine-b"]) {
        const root = join(sandbox, name);
        cpSync(plainRoot, root, { recursive: true });
        const built = await build({
          configFile: false,
          root,
          plugins: [zaakiyPlugin()],
          logLevel: "silent",
          build: { write: false, emptyOutDir: false }
        });
        const output = Array.isArray(built) ? built[0] : built;
        const manifest = (output as RollupOutput).output.find(
          item => item.type === "asset" && item.fileName === "zaakiy-assets.json"
        );
        expect(manifest?.type).toBe("asset");
        manifests.push(String(manifest?.type === "asset" ? manifest.source : ""));
      }
      expect(manifests[0]).toBe(manifests[1]);
      expect(manifests[0]).not.toContain(sandbox.replaceAll("\\", "/"));
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
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

  it("generates CSS from brand and safelist without any TSX source", async () => {
    expect(hasStyles()).toBe(true);
    const result = await build({
      configFile: false,
      root: brandOnlyRoot,
      plugins: [zaakiyPlugin({ configFile: "zaakiy.config.ts" })],
      logLevel: "silent",
      build: { write: false, emptyOutDir: false }
    });
    const output = Array.isArray(result) ? result[0] : result;
    const css = (output as RollupOutput).output.find(
      item => item.type === "asset" && item.fileName === "assets/zaakiy-styles.css"
    );
    expect(css?.type).toBe("asset");
    expect(String(css?.type === "asset" ? css.source : "")).toContain("bg-primary");
  });

  it("compiles real TSX and generated CSS using merged compiler and styles", async () => {
      expect(hasCompiler()).toBe(true);
      expect(hasStyles()).toBe(true);
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
      const entries = (JSON.parse(String(manifest?.type === "asset" ? manifest.source : "")) as {
        assets: Array<{fileName: string; kind: string}>
      }).assets;
      expect(entries.filter(a => a.fileName === "assets/zaakiy-styles.css")).toHaveLength(1);
      expect(new Set(entries.map(a => a.fileName)).size).toBe(entries.length);
      expect(js.every(chunk => !/@zaakiyjs\/(?:ai|proxy|compiler|styles|vite-plugin)/.test(chunk.type === "chunk" ? chunk.code : ""))).toBe(true);
  });

  it("preserves CSS on JS-only hot updates and regenerates it for changed utility tokens", async () => {
    const temp = mkdtempSync(join(dirname(fixtureRoot), ".zaakiy-vite-css-hmr-"));
    cpSync(fixtureRoot, temp, { recursive: true });
    const sourcePath = join(temp, "src", "main.tsx");
    try {
      server = await createServer({
        configFile: false, root: temp,
        plugins: [zaakiyPlugin()], server: { middlewareMode: true, hmr: true }
      });
      const loadCss = async (): Promise<string> => {
        const result = await server!.pluginContainer.load("\u0000virtual:zaakiy-styles.css");
        return typeof result === "string" ? result : result?.code ?? "";
      };
      const first = await server.transformRequest("/src/main.tsx");
      expect(first?.code).toContain("Count:");
      const cssBefore = await loadCss();
      expect(cssBefore).toContain("flex");

      const original = readFileSync(sourcePath, "utf8");
      writeFileSync(sourcePath, original.replace("Count:", "Clicks:"));
      const socketSpy = vi.spyOn(server.ws, "send");
      server.watcher.emit("change", sourcePath);
      await vi.waitFor(() =>
        expect(socketSpy).toHaveBeenCalledWith({ type: "full-reload", path: "*" }),
        { timeout: 4000, interval: 50 }
      );
      const updated = await server.transformRequest("/src/main.tsx");
      expect(updated?.code).toContain("Clicks:");
      expect(await loadCss()).toBe(cssBefore);

      socketSpy.mockClear();
      writeFileSync(sourcePath, readFileSync(sourcePath, "utf8").replace("flex gap-4", "grid gap-4"));
      server.watcher.emit("change", sourcePath);
      await vi.waitFor(() =>
        expect(socketSpy).toHaveBeenCalledWith({ type: "full-reload", path: "*" }),
        { timeout: 4000, interval: 50 }
      );
      await server.transformRequest("/src/main.tsx");
      const updatedCss = await loadCss();
      expect(updatedCss).toContain("grid");
      expect(updatedCss).not.toBe(cssBefore);
      socketSpy.mockRestore();
    } finally {
      await server?.close();
      server = undefined;
      rmSync(temp, { recursive: true, force: true });
    }
  });

});
