import { performance } from "node:perf_hooks";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { mkdir, writeFile } from "node:fs/promises";

const root = resolve(process.argv[2] ?? ".");
const output = resolve(process.argv[3] ?? "benchmark-artifacts/signals-tracking.json");
const { computed, effect, flushSync, signal } =
  await import(pathToFileURL(resolve(root, "packages/signals/dist/index.js")).href);

const fanout = 400;
const updates = 150;
const warmups = 2;
const repetitions = 12;
const percentile = (items, fraction) => {
  const values = [...items].sort((a, b) => a - b);
  const index = (values.length - 1) * fraction;
  const low = Math.floor(index), high = Math.ceil(index);
  return values[low] + (values[high] - values[low]) * (index - low);
};
function sample(mode) {
  const source = signal(0);
  const observed = mode === "direct" ? source : computed(() => source.value * 2);
  let executions = 0;
  const handles = Array.from({ length: fanout }, () =>
    effect(() => { void observed.value; executions++; }));
  const start = performance.now();
  for (let i = 1; i <= updates; i++) {
    source.value = i;
    flushSync();
  }
  const elapsed = performance.now() - start;
  const expected = fanout * (updates + 1);
  if (executions !== expected) {
    throw new Error(mode + " incorrect subscriber executions: " + executions + " vs " + expected);
  }
  for (const handle of handles) handle.dispose();
  source.value++;
  flushSync();
  if (executions !== expected) {
    throw new Error(mode + " effects still subscribed after disposal");
  }
  return elapsed;
}
const modes = [];
for (const mode of ["direct", "computed"]) {
  for (let i = 0; i < warmups; i++) sample(mode);
  const samples = [];
  for (let i = 0; i < repetitions; i++) samples.push(sample(mode));
  modes.push({
    mode, fanout, updates, warmups, repetitions,
    p50_ms: percentile(samples, .5),
    p95_ms: percentile(samples, .95),
    samples_ms: samples,
    expectedCallsPerSample: fanout * (updates + 1),
    postDisposeRuns: 0
  });
}
const result = { schemaVersion: 1, fixture: "signals-direct-vs-computed-v1",
  node: process.version, root, modes };
await mkdir(resolve(output, ".."), { recursive: true });
await writeFile(output, JSON.stringify(result, null, 2) + "\n");
console.log(modes.map(x => x.mode + " p50=" + x.p50_ms.toFixed(2) +
  "ms p95=" + x.p95_ms.toFixed(2) + "ms").join("\n"));