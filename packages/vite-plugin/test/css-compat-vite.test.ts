import {describe, expect, it} from "vitest";
import {build, type RollupOutput} from "vite";
import {cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";
import {zaakiyPlugin} from "../src/index.js";

const plainRoot = fileURLToPath(new URL("./fixtures/plain/", import.meta.url));
function fixture(): {root: string; cleanup: () => void} {
  const root = mkdtempSync(join(dirname(plainRoot), ".zaakiy-css-check-"));
  cpSync(plainRoot, root, {recursive: true});
  const entry = join(root, "src", "index.js");
  writeFileSync(entry, 'import "./features.css";\n' + readFileSync(entry, "utf8"));
  writeFileSync(join(root, "src", "features.css"),
    '@container (min-width: 32rem) { .grid { display: grid; } }\n');
  return {root, cleanup: () => rmSync(root, {recursive: true, force: true})};
}
function manifest(built: Awaited<ReturnType<typeof build>>) {
  const output = Array.isArray(built) ? built[0] : built;
  const compat = (output as RollupOutput).output.find(item =>
    item.type === "asset" && item.fileName === "compat-manifest.json");
  return JSON.parse(String(compat?.type === "asset" ? compat.source : "")) as {
    mode: string; detectedFeatures: {id: string; status: string}[]; unsupportedFeatures: string[];
  };
}
describe("Vite emitted CSS compatibility gates", () => {
  it("fails closed in strict and auto when no approved CSS fallback exists", async () => {
    const t = fixture();
    try {
      for (const mode of ["strict", "auto"] as const) {
        await expect(build({
          configFile: false, root: t.root, logLevel: "silent",
          plugins: [zaakiyPlugin({compatibility: {
            mode, targets: {browsers: ["firefox >=100"]}
          }})],
          build: {write: false, emptyOutDir: false}
        })).rejects.toThrow("ZV4003");
      }
    } finally {t.cleanup();}
  });
  it("reports native emitted CSS support for compatible declared browsers", async () => {
    const t = fixture();
    try {
      const built = await build({
        configFile: false, root: t.root, logLevel: "silent",
        plugins: [zaakiyPlugin({compatibility: {
          mode: "strict", targets: {browsers: ["firefox >=124", "safari >=17.4"]}
        }})],
        build: {write: false, emptyOutDir: false}
      });
      const result = manifest(built);
      expect(result.mode).toBe("strict");
      expect(result.unsupportedFeatures).toHaveLength(0);
      expect(result.detectedFeatures).toEqual(expect.arrayContaining([
        expect.objectContaining({id: "css.container-query", status: "native"})
      ]));
    } finally {t.cleanup();}
  });
  it("off mode bypasses feature analysis explicitly rather than claiming compatibility", async () => {
    const t = fixture();
    try {
      const built = await build({
        configFile: false, root: t.root, logLevel: "silent",
        plugins: [zaakiyPlugin({compatibility: {
          mode: "off", targets: {browsers: ["firefox >=100"]}
        }})],
        build: {write: false, emptyOutDir: false}
      });
      const result = manifest(built);
      expect(result.mode).toBe("off");
      expect(result.detectedFeatures).toHaveLength(0);
    } finally {t.cleanup();}
  });
});
