import { describe, expect, it } from "vitest";
import { build } from "vite";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const currentDir = fileURLToPath(new URL(".", import.meta.url));
const browsers = [
  process.env.CHROME_BIN,
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser"
].filter((value): value is string => Boolean(value));

function findChromium(): string | null {
  for (const executable of browsers) if (existsSync(executable)) return executable;
  return null;
}

describe("real Chromium compiler-ABI smoke", () => {
  it("preserves targeted mutations, keyed focus and cleanup in a native browser", async () => {
    const chrome = findChromium();
    if (!chrome) {
      // A transparent skip rather than a fabricated browser pass.
      console.warn("Chromium not installed: native browser smoke not executed");
      return;
    }
    const outDir = mkdtempSync(join(tmpdir(), "zaakiy-dom-browser-"));
    try {
      await build({
        configFile: false,
        logLevel: "error",
        build: {
          outDir,
          emptyOutDir: true,
          minify: "esbuild",
          lib: {
            entry: join(currentDir, "browser-entry.ts"),
            name: "ZaakiyDomSmoke",
            formats: ["iife"],
            fileName: () => "bundle.js"
          }
        }
      });
      const bundle = readFileSync(join(outDir, "bundle.js"));
      console.info(
        "ZaakiyJS browser smoke bundle (includes test harness + core/signals):",
        bundle.byteLength, "bytes raw,", gzipSync(bundle).byteLength, "bytes gzip"
      );
      writeFileSync(join(outDir, "index.html"),
        '<!doctype html><html><head><meta charset="utf-8"></head>' +
        '<body><script src="bundle.js"></script></body></html>');
      const launched = spawnSync(chrome, [
        "--headless=new", "--no-sandbox", "--disable-gpu",
        "--disable-dev-shm-usage", "--disable-extensions",
        "--allow-file-access-from-files", "--virtual-time-budget=1000",
        "--dump-dom", "file://" + join(outDir, "index.html")
      ], { encoding: "utf8", timeout: 30000, maxBuffer: 1024 * 1024 });
      expect(launched.error).toBeUndefined();
      expect(launched.status, launched.stderr || undefined).toBe(0);
      expect(launched.stdout).toContain('data-zaakiy-browser-result="pass"');
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  }, 45000);
});
