import {readdir, readFile, mkdir, writeFile} from "node:fs/promises";
import {join, resolve} from "node:path";
import {gzipSync, brotliCompressSync, constants} from "node:zlib";

const included = /\.(?:js|mjs|cjs|css)$/;
const byName = (a, b) => a.localeCompare(b, "en");

async function compiledFiles(dir) {
  const found = [];
  async function walk(path) {
    let entries;
    try { entries = await readdir(path, {withFileTypes: true}); }
    catch (error) {
      if (error?.code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries.sort((a, b) => byName(a.name, b.name))) {
      const full = join(path, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile() && included.test(entry.name)) {
        const bytes = await readFile(full);
        found.push({
          raw: bytes.length,
          gzip: gzipSync(bytes, {level: 9}).length,
          brotli: brotliCompressSync(bytes, {params: {[constants.BROTLI_PARAM_QUALITY]: 11}}).length
        });
      }
    }
  }
  await walk(dir);
  return found;
}

async function inventory(root) {
  const packages = {};
  for (const folder of (await readdir(root, {withFileTypes: true}))
    .filter(entry => entry.isDirectory()).map(entry => entry.name).sort(byName)) {
    const path = join(root, folder);
    let metadata;
    try { metadata = JSON.parse(await readFile(join(path, "package.json"), "utf8")); }
    catch (error) { throw new Error("Invalid/missing package manifest at " + folder, {cause: error}); }
    const files = await compiledFiles(join(path, "dist"));
    if (files.length === 0) throw new Error("No emitted JS/CSS in " + metadata.name);
    packages[metadata.name] = {
      files: files.length,
      ...Object.fromEntries(["raw", "gzip", "brotli"].map(type => [
        type, files.reduce((total, item) => total + item[type], 0)
      ]))
    };
  }
  return packages;
}
const baseline = await inventory(resolve(".benchmark-baseline/packages"));
const hardening = await inventory(resolve(".benchmark-hardening/packages"));
const candidate = await inventory(resolve("packages"));
// The two pinned historical baselines contain 23 packages. A newly added
// candidate package has no meaningful historical footprint: retain exact
// parity checks for all existing packages and explicitly account for additions.
const baselineNames = Object.keys(baseline).sort(byName);
const hardeningNames = Object.keys(hardening).sort(byName);
const candidateNames = Object.keys(candidate).sort(byName);
const approvedAdditions = new Set(["@zaakiyjs/image"]);
const additions = candidateNames.filter(name => !baseline[name]);
if (baselineNames.length !== 23 || hardeningNames.length !== 23 ||
    baselineNames.some(name => !hardening[name] || !candidate[name]) ||
    hardeningNames.some(name => !baseline[name]) ||
    additions.length !== approvedAdditions.size ||
    additions.some(name => !approvedAdditions.has(name))) {
  throw new Error("Production package coverage mismatch: missing historical package or unreviewed candidate addition");
}
const rows = candidateNames.map(name => {
  const before = baseline[name] ?? null;
  const hardened = hardening[name] ?? null;
  const after = candidate[name];
  return {
    package: name, baseline: before, hardening: hardened, candidate: after,
    status: before ? "existing" : "added",
    gzipDelta: before ? after.gzip - before.gzip : null,
    hardeningGzipDelta: hardened ? after.gzip - hardened.gzip : null,
    gzipDeltaPct: before?.gzip ? 100 * (after.gzip / before.gzip - 1) : null,
    hardeningGzipDeltaPct: hardened?.gzip ? 100 * (after.gzip / hardened.gzip - 1) : null
  };
});
await mkdir("benchmark-artifacts", {recursive: true});
await writeFile("benchmark-artifacts/package-sizes.json", JSON.stringify({
  schemaVersion: 1, note: "Sum of individually compressed emitted package JS/CSS files; NOT runtime chunk, npm tarball or transferred browser bytes",
  packages: rows
}, null, 2) + "\n");
for (const row of rows) console.log(row.package.padEnd(26),
  "main", String(row.baseline?.gzip ?? "new").padStart(8),
  "candidate", String(row.candidate.gzip).padStart(8),
  "delta", row.gzipDeltaPct === null ? "new package" : row.gzipDeltaPct.toFixed(1) + "%");