import {performance} from "node:perf_hooks";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {writeFile, mkdir} from "node:fs/promises";

const root = resolve(process.argv[2] ?? ".");
const output = process.argv[3] ?? "benchmark-artifacts/core.json";
const {createOwner, disposeOwner, onCleanup, runWithOwner} =
  await import(pathToFileURL(resolve(root, "packages/core/dist/index.js")).href);

const childrenPerCycle = 2000;
const repetitions = 30;
let callbacks = 0;
const sample = () => {
  const rootOwner = createOwner();
  runWithOwner(rootOwner, () => onCleanup(() => { callbacks++; }));
  for (let i = 0; i < childrenPerCycle; i++) {
    const child = createOwner(rootOwner);
    runWithOwner(child, () => onCleanup(() => { callbacks++; }));
  }
  disposeOwner(rootOwner);
};
for (let i = 0; i < 5; i++) sample();
const before = callbacks;
const samples = [];
for (let iteration = 0; iteration < repetitions; iteration++) {
  const started = performance.now();
  sample();
  samples.push(performance.now() - started);
}
const expected = repetitions * (childrenPerCycle + 1);
if (callbacks - before !== expected) {
  throw new Error("Owner-scoped cleanup failed: " + (callbacks - before) + " vs " + expected);
}
const ordered = samples.toSorted((a, b) => a - b);
const percentile = fraction => {
  const index = (ordered.length - 1) * fraction;
  const low = Math.floor(index), high = Math.ceil(index);
  return ordered[low] + (ordered[high] - ordered[low]) * (index - low);
};
const result = {
  schemaVersion: 1, node: process.version, root, childrenPerCycle, repetitions,
  callbacksVerified: expected,
  p50_ms: percentile(0.5), p95_ms: percentile(0.95),
  mean_ms: samples.reduce((a, b) => a + b, 0) / samples.length,
  samples_ms: samples
};
await mkdir(resolve(output, ".."), {recursive: true});
await writeFile(output, JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify({childrenPerCycle, repetitions,
  p50_ms: result.p50_ms, p95_ms: result.p95_ms}, null, 2));
