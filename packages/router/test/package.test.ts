import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const packageDir = fileURLToPath(new URL("../", import.meta.url));

describe("router package publish and server boundaries", () => {
  it("ESM imports without window or document globals", () => {
    const probe = [
      "delete globalThis.window;",
      "delete globalThis.document;",
      "const pkg = await import('./dist/index.js');",
      "if (typeof pkg.createRouter !== 'function') throw new Error('createRouter export missing');",
      "if (typeof pkg.defineRoute !== 'function') throw new Error('defineRoute export missing');"
    ].join("\n");
    expect(() => execFileSync(process.execPath, ["--input-type=module", "-e", probe], {
      cwd: packageDir, encoding: "utf8"
    })).not.toThrow();
  });

  it("packs compiled ESM, declarations and release metadata without source code", () => {
    const output = execFileSync("npm", ["pack", "--dry-run", "--json"], {
      cwd: packageDir, encoding: "utf8"
    });
    const parsed = JSON.parse(output) as Array<{ files: Array<{ path: string }> }>;
    const contents = new Set(parsed[0]?.files.map(file => file.path) ?? []);
    expect(contents.has("dist/index.js")).toBe(true);
    expect(contents.has("dist/index.d.ts")).toBe(true);
    expect(contents.has("README.md")).toBe(true);
    expect(contents.has("CHANGELOG.md")).toBe(true);
    expect(contents.has("package.json")).toBe(true);
    expect([...contents].filter(path => path.startsWith("test/") || path.startsWith("src/"))).toEqual([]);
  });
});
