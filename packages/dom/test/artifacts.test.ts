import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));

describe("published DOM artifacts", () => {
  it("emits ESM, declarations and source maps with no compiler dependency", () => {
    const artifacts = [
      "index.js", "compiler.js", "regions.js",
      "index.d.ts", "compiler.d.ts", "regions.d.ts",
      "index.js.map", "compiler.js.map", "regions.js.map"
    ];
    for (const path of artifacts) {
      expect(existsSync(join(packageRoot, "dist", path)), path).toBe(true);
    }
    const javascript = artifacts
      .filter(path => path.endsWith(".js"))
      .map(path => readFileSync(join(packageRoot, "dist", path), "utf8"));
    expect(javascript.join("\n")).not.toContain("@zaakiyjs/compiler");
    expect(javascript.join("\n")).not.toMatch(/\b(?:ReactDOM|Zone\.js|eval)\b/);
    const bytes = javascript.map(code => Buffer.byteLength(code));
    const gzipped = javascript.map(code => gzipSync(code).byteLength);
    console.info("DOM ESM artifacts (unbundled, excluding core/signals):",
      bytes.reduce((a, b) => a + b, 0), "bytes JS,",
      gzipped.reduce((a, b) => a + b, 0), "bytes sum of individual gzips");
  });

  it("packs ESM and declarations without test sources", () => {
    const pack = spawnSync("npm", ["pack", "--dry-run", "--json"], {
      cwd: packageRoot,
      encoding: "utf8",
      timeout: 30000
    });
    expect(pack.status, pack.stderr).toBe(0);
    const result = JSON.parse(pack.stdout) as Array<{
      files: Array<{ path: string }>
    }>;
    const contents = result[0]?.files.map(file => file.path) ?? [];
    for (const path of ["dist/index.js", "dist/compiler.js", "dist/index.d.ts", "dist/compiler.d.ts"]) {
      expect(contents, path).toContain(path);
    }
    expect(contents.some(path => path.startsWith("test/"))).toBe(false);
    expect(contents.some(path => path.startsWith("src/"))).toBe(false);
  }, 45000);
});
