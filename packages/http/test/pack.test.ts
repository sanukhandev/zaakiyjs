import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
describe("published ESM package", () => {
  it("packs files and imports from an independent consumer", () => {
    const cwd = dirname(dirname(fileURLToPath(import.meta.url)));
    const temp = mkdtempSync(join(tmpdir(), "zaakiy-http-pack-"));
    try {
      // Root CI verifier is integration-owned; validate the package-local lint gate here.
      execFileSync("pnpm", ["run", "lint"], { cwd, stdio: "pipe" });
      execFileSync("pnpm", ["pack", "--pack-destination", temp], { cwd });
      const tgz = readdirSync(temp).find(x => x.endsWith(".tgz"));
      expect(tgz).toBeDefined();
      const target = join(temp, "extracted"); mkdirSync(target);
      execFileSync("tar", ["-xzf", join(temp, tgz!), "-C", target]);
      const pkg = join(target, "package");
      expect(existsSync(join(pkg, "dist/index.js"))).toBe(true);
      expect(existsSync(join(pkg, "dist/index.d.ts"))).toBe(true);
      const chunks = readdirSync(join(pkg, "dist")).filter(x => x.endsWith(".js")).map(x => readFileSync(join(pkg, "dist", x)));
      console.info("HTTP raw ESM bytes:", chunks.reduce((n, b) => n + b.byteLength, 0),
        "combined gzip bytes:", gzipSync(Buffer.concat(chunks)).byteLength);
      const consumer = join(temp, "consumer");
      const scope = join(consumer, "node_modules/@zaakiyjs"); mkdirSync(scope, { recursive: true });
      symlinkSync(pkg, join(scope, "http"), "dir");
      writeFileSync(join(consumer, "package.json"), '{"private":true,"type":"module"}');
      writeFileSync(join(consumer, "consumer.mjs"),
        'import { createHttpClient } from "@zaakiyjs/http";\n' +
        'const client = createHttpClient({ baseURL: "https://example.test", fetch: async () => new Response("ok") });\n' +
        'if (await client.get("/test") !== "ok") throw Error("ESM failed");\nclient.dispose();\n');
      execFileSync(process.execPath, ["consumer.mjs"], { cwd: consumer });
    } finally { rmSync(temp, { recursive: true, force: true }); }
  });
});
