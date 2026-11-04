import { afterEach, describe, expect, it } from "vitest";
import { build, createServer, type ViteDevServer } from "vite";
import { fileURLToPath } from "node:url";
import { hasCompiler, hasStyles } from "../src/bridge.js";
import { zaakiyPlugin } from "../src/plugin.js";

const fixtureRoot = fileURLToPath(new URL("./fixtures/basic/", import.meta.url));
const brandRoot = fileURLToPath(new URL("./fixtures/bad-brand/", import.meta.url));
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
    }
  );
});
