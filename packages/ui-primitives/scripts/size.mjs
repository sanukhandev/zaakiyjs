#!/usr/bin/env node
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../dist/", import.meta.url));
const files = [];
function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path);
    else if (entry.isFile() && entry.name.endsWith(".js")) files.push(path);
  }
}
walk(root);
files.sort();
if (files.length === 0) throw new Error("Run the package build before measuring size");
const bytes = Buffer.concat(files.map(file => readFileSync(file)));
console.log(JSON.stringify({
  package: "@zaakiyjs/ui-primitives",
  measurement: "unminified ESM module set, not a tree-shaken consumer bundle",
  modules: files.map(file => relative(root, file)),
  moduleCount: files.length,
  rawBytes: bytes.length,
  gzipBytes: gzipSync(bytes, { level: 9 }).length,
  dependencies: ["@zaakiyjs/core", "@zaakiyjs/signals"]
}, null, 2));
