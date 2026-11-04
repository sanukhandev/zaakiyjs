import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));

describe("independent compiler package artifacts", () => {
  it("builds importable ESM and declarations without browser framework dependencies", () => {
    for (const path of [
      "index.js", "index.d.ts", "index.js.map",
      "analysis.js", "generate.js", "optimize.js"
    ]) {
      expect(existsSync(join(root, "dist", path)), path).toBe(true);
    }
    const entry = readFileSync(join(root, "dist", "index.js"), "utf8");
    expect(entry).toContain('from "./analysis.js"');
    expect(entry).not.toMatch(/react-dom|@angular|zone\.js|@zaakiyjs\/ai/);
  });

  it("packs generated dist and documentation, never tests/source", () => {
    const result = spawnSync("npm", ["pack", "--dry-run", "--json"], {
      cwd: root, encoding: "utf8", timeout: 30000
    });
    expect(result.status, result.stderr).toBe(0);
    const values = JSON.parse(result.stdout) as Array<{ files: Array<{ path: string }> }>;
    const files = values[0]?.files.map(file => file.path) ?? [];
    for (const path of ["dist/index.js", "dist/index.d.ts", "README.md"]) {
      expect(files, path).toContain(path);
    }
    expect(files.some(path => path.startsWith("src/") || path.startsWith("test/"))).toBe(false);
  }, 45000);
});
