import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspectPackageExports } from "./package-exports.mjs";

function fixture(exports, callback, options = {}) {
  const root = mkdtempSync(join(tmpdir(), "zaakiy-exports-"));
  const directory = join(root, "packages", "alpha");
  try {
    mkdirSync(join(directory, "dist"), { recursive: true });
    writeFileSync(join(directory, "package.json"), JSON.stringify({
      name: "@zaakiyjs/alpha", exports, types: "./dist/index.d.ts",
      ...(options.bin ? { bin: { alpha: "./dist/bin.js" } } : {})
    }));
    writeFileSync(join(directory, "dist", "index.js"), "export {};\n");
    writeFileSync(join(directory, "dist", "index.d.ts"), "export {};\n");
    if (options.bin) writeFileSync(join(directory, "dist", "bin.js"), "#!/usr/bin/env node\n");
    callback(root, directory);
  } finally { rmSync(root, { recursive: true, force: true }); }
}

test("valid nested conditional exports and CLI binaries", () => {
  fixture({ ".": { node: { types: "./dist/index.d.ts", import: "./dist/index.js" } } }, root => {
    const result = inspectPackageExports(root);
    assert.deepEqual(result.findings, []);
    assert.equal(result.packages[0]?.verifiedTargets, 4);
  }, { bin: true });
});

test("missing output file blocks package certification", () => {
  fixture({ ".": { import: "./dist/missing.js" } }, root => {
    const result = inspectPackageExports(root);
    assert.ok(result.findings.some(f => f.message.includes("Export file missing")));
  });
});

test("path traversal and invalid conditional entry fail closed", () => {
  fixture({ ".": { import: "./../outside.js", invalid: null } }, root => {
    const result = inspectPackageExports(root);
    assert.ok(result.findings.some(f => f.message.includes("escapes package directory")));
    assert.ok(result.findings.some(f => f.message.includes("invalid conditional export")));
  });
});
