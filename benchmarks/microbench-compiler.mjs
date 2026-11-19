import {performance} from "node:perf_hooks";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {readFile, writeFile, mkdir} from "node:fs/promises";
import {createHash} from "node:crypto";

const root = resolve(process.argv[2] ?? ".");
const output = process.argv[3] ?? "benchmark-artifacts/compiler.json";
const sourceFile = resolve(root, "apps/benchmark-app/src/App.tsx");
const source = await readFile(sourceFile, "utf8");
const {compile} = await import(pathToFileURL(resolve(root, "packages/compiler/dist/index.js")).href);
const request = {fileName: sourceFile, rootDir: root, source};
const warmups = 3, repetitions = 12;
const hashes = new Set();
const samples = [];
for (let i = -warmups; i < repetitions; i++) {
  const started = performance.now();
  const result = compile(request);
  const ms = performance.now() - started;
  if (result.diagnostics.some(item => item.severity === "error") ||
      result.js.length !== 1 || !result.js[0].code) {
    throw new Error("Compiler benchmark failed to emit valid supported fixture: " +
      JSON.stringify(result.diagnostics));
  }
  hashes.add(createHash("sha256").update(result.js[0].code).digest("hex"));
  if (i >= 0) samples.push(ms);
}
if (hashes.size !== 1) throw new Error("Compiler output is nondeterministic under pinned inputs");
const sorted = samples.toSorted((a, b) => a - b);
const percentile = fraction => {
  const index = (sorted.length - 1) * fraction;
  const low = Math.floor(index), high = Math.ceil(index);
  return sorted[low] + (sorted[high] - sorted[low]) * (index - low);
};
const report = {
  schemaVersion: 1, node: process.version, root, warmups, repetitions,
  stableOutputSha256: [...hashes][0],
  p50_ms: percentile(0.5), p95_ms: percentile(0.95),
  samples_ms: samples
};
await mkdir(resolve(output, ".."), {recursive: true});
await writeFile(output, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({warmups, repetitions, p50_ms: report.p50_ms,
  p95_ms: report.p95_ms, sha256: report.stableOutputSha256}, null, 2));
