import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";

describe("external ESM package consumer", () => {
  it("packs its declarations and imports from outside the workspace", () => {
    const temp = mkdtempSync(join(tmpdir(), "zaakiy-async-consumer-"));
    const packageDir = dirname(dirname(fileURLToPath(import.meta.url)));
    const packagesDir = dirname(packageDir);
    try {
      execFileSync("pnpm", ["pack", "--pack-destination", temp], { cwd: packageDir, stdio: "pipe" });
      const archive = readdirSync(temp).find(name => name.endsWith(".tgz"));
      expect(archive).toBeDefined();
      const extract = join(temp, "extract");
      mkdirSync(extract);
      execFileSync("tar", ["-xzf", join(temp, archive!), "-C", extract]);
      const packed = join(extract, "package");
      expect(existsSync(join(packed, "dist", "index.js"))).toBe(true);
      expect(existsSync(join(packed, "dist", "index.d.ts"))).toBe(true);
      const emitted = readdirSync(join(packed, "dist"))
        .filter(name => name.endsWith(".js")).sort()
        .map(name => readFileSync(join(packed, "dist", name)));
      const rawBytes = emitted.reduce((sum, code) => sum + code.byteLength, 0);
      const combinedGzipBytes = gzipSync(Buffer.concat(emitted)).byteLength;
      const archiveBytes = statSync(join(temp, archive!)).size;
      expect(rawBytes).toBeGreaterThan(0);
      expect(archiveBytes).toBeGreaterThan(0);
      // Combined emitted modules are not equivalent to a tree-shaken consumer bundle.
      console.info(`@zaakiyjs/async package size: ${rawBytes} B emitted ESM, ${combinedGzipBytes} B combined gzip, ${archiveBytes} B npm archive`);
      // Node resolves symlinks to real paths; dependencies must be resolvable
      // from the extracted tarball rather than only from the consumer directory.
      const packedScope = join(packed, "node_modules", "@zaakiyjs");
      mkdirSync(packedScope, { recursive: true });
      for (const name of ["signals", "core"]) {
        symlinkSync(join(packagesDir, name), join(packedScope, name), "dir");
      }
      const consumer = join(temp, "consumer");
      const scope = join(consumer, "node_modules", "@zaakiyjs");
      mkdirSync(scope, { recursive: true });
      symlinkSync(packed, join(scope, "async"), "dir");
      writeFileSync(join(consumer, "package.json"), '{"private":true,"type":"module"}');
      writeFileSync(join(consumer, "consumer.mjs"), [
        'import { createResource, createTask } from "@zaakiyjs/async";',
        'const task = createTask({ owner: null, execute: async ({ input }) => input + 1 });',
        'if (await task.run(1) !== 2) throw new Error("task export failed");',
        'const resource = createResource({ owner: null, load: async () => 4 });',
        'if (await resource.refresh() !== 4) throw new Error("resource export failed");',
        'task.dispose(); resource.dispose();'
      ].join("\n"));
      execFileSync(process.execPath, ["consumer.mjs"], { cwd: consumer, stdio: "pipe" });
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });
});
