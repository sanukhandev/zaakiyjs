#!/usr/bin/env node
/** Canonical content hashes for every published package artifact, stable across builds. */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const packages = ["signals", "core", "dom", "compiler", "styles", "vite-plugin", "cli"];
const artifacts = [];
function visit(path) {
  for (const entry of readdirSync(path).sort()) {
    const full = join(path, entry);
    if (statSync(full).isDirectory()) visit(full);
    else if (statSync(full).isFile()) {
      artifacts.push([relative(root, full).replaceAll("\\", "/"),
        createHash("sha256").update(readFileSync(full)).digest("hex")]);
    }
  }
}
for (const name of packages) {
  const folder = join(root, "packages", name, "dist");
  if (!existsSync(folder)) throw new Error("Missing distributable output: " + folder);
  visit(folder);
}
if (!artifacts.length) throw new Error("No built artifacts found");
console.log(artifacts.map(([file, digest]) => digest + "  " + file).join("\n"));
