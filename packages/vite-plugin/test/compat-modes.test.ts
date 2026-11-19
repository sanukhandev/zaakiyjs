import {describe, expect, it} from "vitest";
import {build, type RollupOutput} from "vite";
import {cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";
import {zaakiyPlugin} from "../src/index.js";

const fixture = fileURLToPath(new URL("./fixtures/basic/", import.meta.url));
const plain = fileURLToPath(new URL("./fixtures/plain/", import.meta.url));
function asset(result: Awaited<ReturnType<typeof build>>, name: string): string {
  const output = Array.isArray(result) ? result[0] : result;
  const item = (output as RollupOutput).output.find(file => file.fileName === name);
  if (!item || item.type !== "asset") throw new Error("Missing build artifact: " + name);
  return String(item.source);
}
function chunks(result: Awaited<ReturnType<typeof build>>): string[] {
  const output = Array.isArray(result) ? result[0] : result;
  return (output as RollupOutput).output.filter(file => file.type === "chunk").map(file => file.code);
}
function withFixture(): {root: string; source: string; cleanup: () => void} {
  const root = mkdtempSync(join(dirname(fixture), ".zaakiy-compat-mode-"));
  cpSync(fixture, root, {recursive: true});
  const source = join(root, "src", "main.tsx");
  return {root, source, cleanup: () => rmSync(root, {recursive: true, force: true})};
}

describe("Vite compatibility modes", () => {
  it("explicit off mode emits a disabled manifest and does not promise feature compatibility", async () => {
    const temp = withFixture();
    try {
      writeFileSync(temp.source, readFileSync(temp.source, "utf8") +
        "\nconst unsupported = AbortSignal.any([]); void unsupported;\n");
      const result = await build({
        configFile: false, root: temp.root, logLevel: "silent",
        plugins: [zaakiyPlugin({compatibility: {mode: "off",
          targets: {browsers: ["firefox >=100"]}}})],
        build: {write: false, emptyOutDir: false}
      });
      const manifest = JSON.parse(asset(result, "compat-manifest.json")) as {
        mode: string; transforms: unknown[]; shims: unknown[];
        detectedFeatures: unknown[]; limitations: string[];
      };
      expect(manifest.mode).toBe("off");
      expect(manifest.detectedFeatures).toHaveLength(0);
      expect(manifest.transforms).toHaveLength(0);
      expect(manifest.shims).toHaveLength(0);
      expect(manifest.limitations.length).toBeGreaterThan(0);
      expect(asset(result, "zaakiy-assets.json")).toContain("compat-manifest.json");
    } finally {temp.cleanup();}
  });

  it("auto mode selects approved ES2019 lowering with final emitted browser validation", async () => {
    const temp = withFixture();
    try {
      writeFileSync(temp.source, readFileSync(temp.source, "utf8") +
        "\nlet activated = false; activated ||= true; document.body.dataset.compat = String(activated);\n");
      const result = await build({
        configFile: false, root: temp.root, logLevel: "silent",
        plugins: [zaakiyPlugin({compatibility: {mode: "auto",
          targets: {browsers: ["safari >=13.1"]}}})],
        build: {write: false, emptyOutDir: false, sourcemap: true}
      });
      const manifest = JSON.parse(asset(result, "compat-manifest.json")) as {
        mode: string; transforms: {id: string}[]; shims: unknown[];
      };
      expect(manifest.mode).toBe("auto");
      expect(manifest.shims).toHaveLength(0);
      expect(manifest.transforms.map(item => item.id)).toContain("typescript-5.9.3-es2019");
      expect(chunks(result).length).toBeGreaterThan(0);
      expect(chunks(result).every(code => !code.includes("||="))).toBe(true);
      expect(asset(result, "zaakiy-assets.json")).toContain("compat-manifest.json");
    } finally {temp.cleanup();}
  });

  it("auto mode fails closed when an unapproved web API needs a shim", async () => {
    const temp = withFixture();
    try {
      writeFileSync(temp.source, readFileSync(temp.source, "utf8") +
        "\nconst unsupported = AbortSignal.any([]); void unsupported;\n");
      await expect(build({
        configFile: false, root: temp.root, logLevel: "silent",
        plugins: [zaakiyPlugin({compatibility: {mode: "auto",
          targets: {browsers: ["firefox >=100"]}}})],
        build: {write: false, emptyOutDir: false}
      })).rejects.toThrow("ZV4003");
    } finally {temp.cleanup();}
  });

  it("rejects transforms in off mode rather than implying an active policy", async () => {
    await expect(build({
      configFile: false, root: plain, logLevel: "silent",
      plugins: [zaakiyPlugin({compatibility: {
        mode: "off", targets: {profile: "modern-2024"},
        syntaxTransforms: "approved-es2019"
      }})],
      build: {write: false, emptyOutDir: false}
    })).rejects.toThrow("ZV4001");
  });
});
