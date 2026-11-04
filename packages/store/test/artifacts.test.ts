import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

describe("store publishable ESM artifacts", () => {
  it("emits public ESM and type declarations before packing", () => {
    const manifest = JSON.parse(readFileSync(resolve(packageRoot, "package.json"), "utf8")) as {
      exports: { ".": { types: string; import: string } };
      dependencies: Record<string, string>;
      sideEffects: boolean;
    };
    expect(manifest.sideEffects).toBe(false);
    expect(manifest.dependencies).toEqual({
      "@zaakiyjs/core": "workspace:^", "@zaakiyjs/signals": "workspace:^"
    });
    expect(existsSync(resolve(packageRoot, manifest.exports["."].import))).toBe(true);
    expect(existsSync(resolve(packageRoot, manifest.exports["."].types))).toBe(true);
    const output = execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
      cwd: packageRoot, encoding: "utf8", timeout: 20_000, env: { ...process.env, npm_config_offline: "true" }
    });
    const result = JSON.parse(output) as Array<{ files: Array<{ path: string }> }>;
    const files = result[0]?.files.map(file => file.path) ?? [];
    expect(files).toContain("dist/index.js");
    expect(files).toContain("dist/index.d.ts");
    expect(files.some(file => file.startsWith("test/"))).toBe(false);
  });
});
