import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("packaged public ESM contract", () => {
  it("packs and imports from an isolated external Node consumer", () => {
    const temp = mkdtempSync(join(tmpdir(), "zaakiy-core-consumer-"));
    const packageDir = dirname(dirname(fileURLToPath(import.meta.url)));
    try {
      execFileSync("pnpm", ["pack", "--pack-destination", temp], {
        cwd: packageDir, stdio: "pipe"
      });
      const archive = readdirSync(temp).find(file => file.endsWith(".tgz"));
      expect(archive).toBeDefined();
      const extract = join(temp, "extracted");
      mkdirSync(extract);
      execFileSync("tar", ["-xzf", join(temp, archive!), "-C", extract]);
      const packed = join(extract, "package");
      expect(existsSync(join(packed, "dist", "index.js"))).toBe(true);
      expect(existsSync(join(packed, "dist", "index.d.ts"))).toBe(true);
      const consumer = join(temp, "consumer");
      mkdirSync(join(consumer, "node_modules", "@zaakiyjs"), { recursive: true });
      symlinkSync(packed, join(consumer, "node_modules", "@zaakiyjs", "core"), "dir");
      writeFileSync(join(consumer, "package.json"), '{"private":true,"type":"module"}');
      writeFileSync(join(consumer, "consumer.mjs"), [
        'import { createOwner, createContext, provide, requireContext, disposeOwner } from "@zaakiyjs/core";',
        'const root = createOwner();',
        'const token = createContext("answer");',
        'provide(root, token, 42);',
        'if (requireContext(root, token) !== 42) throw new Error("Provider import failed");',
        'disposeOwner(root);',
        'if (!root.disposed) throw new Error("Owner disposal failed");'
      ].join("\n"));
      execFileSync(process.execPath, ["consumer.mjs"], { cwd: consumer, stdio: "pipe" });
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });
});
