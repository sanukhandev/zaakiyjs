import { performance } from "node:perf_hooks";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { mkdir, writeFile } from "node:fs/promises";

if (typeof globalThis.gc !== "function") {
  throw new Error("B6 retention benchmark requires node --expose-gc");
}
const workspace = resolve(process.argv[2] ?? ".");
const output = resolve(process.argv[3] ?? "benchmark-artifacts/owner-retention.json");
const { createOwner, disposeOwner, onCleanup, ownEffect, runWithOwner } =
  await import(pathToFileURL(resolve(workspace, "packages/core/dist/index.js")).href);
const { batch, effect, flushSync, signal } =
  await import(pathToFileURL(resolve(workspace, "packages/signals/dist/index.js")).href);
const children = 200;
const cyclesPerCheckpoint = 20;
const checkpoints = 8;
const warmupCycles = 4;
let cleanupCount = 0;
let effectRuns = 0;
let postDisposeRuns = 0;

function cycle() {
  const owner = createOwner();
  const values = [];
  const initialCleanups = cleanupCount;
  const initialRuns = effectRuns;
  for (let index = 0; index < children; index++) {
    const child = createOwner(owner);
    const value = signal(0);
    values.push(value);
    runWithOwner(child, () => {
      onCleanup(() => { cleanupCount++; });
      ownEffect(() => effect(() => {
        void value.value;
        effectRuns++;
      }));
    });
  }
  if (effectRuns - initialRuns !== children) {
    throw new Error("Each newly owned effect must run exactly once");
  }
  batch(() => { for (const value of values) value.value = 1; });
  flushSync();
  if (effectRuns - initialRuns !== children * 2) {
    throw new Error("Each owned effect must update exactly once");
  }
  disposeOwner(owner);
  if (cleanupCount - initialCleanups !== children || !owner.disposed) {
    throw new Error("Every child cleanup must complete exactly once");
  }
  const beforeLateWrites = effectRuns;
  batch(() => { for (const value of values) value.value = 2; });
  flushSync();
  postDisposeRuns += effectRuns - beforeLateWrites;
  if (effectRuns !== beforeLateWrites) {
    throw new Error("Disposed effects retained a signal subscription");
  }
}

const percentile = (items, fraction) => {
  const ordered = [...items].sort((a, b) => a - b);
  const position = (ordered.length - 1) * fraction;
  const low = Math.floor(position);
  const high = Math.ceil(position);
  return ordered[low] + (ordered[high] - ordered[low]) * (position - low);
};
function forcedHeap() {
  globalThis.gc();
  globalThis.gc();
  return process.memoryUsage().heapUsed;
}

for (let i = 0; i < warmupCycles; i++) cycle();
const heapSamples = [forcedHeap()];
const timings = [];
for (let checkpoint = 0; checkpoint < checkpoints; checkpoint++) {
  for (let index = 0; index < cyclesPerCheckpoint; index++) {
    const start = performance.now();
    cycle();
    timings.push(performance.now() - start);
  }
  heapSamples.push(forcedHeap());
}
const measuredCycles = checkpoints * cyclesPerCheckpoint;
const expectedCleanups = (measuredCycles + warmupCycles) * children;
const expectedRuns = expectedCleanups * 2;
if (cleanupCount !== expectedCleanups || effectRuns !== expectedRuns || postDisposeRuns !== 0) {
  throw new Error("B6 owner/effect lifecycle assertions failed");
}
const result = {
  schemaVersion: 1,
  fixture: "owner-effect-dispose-200-v1",
  node: process.version,
  workspace,
  children,
  cyclesPerCheckpoint,
  checkpoints,
  measuredCycles,
  cleanupCount,
  expectedCleanups,
  effectRuns,
  expectedRuns,
  postDisposeRuns,
  p50_ms: percentile(timings, 0.5),
  p95_ms: percentile(timings, 0.95),
  timings_ms: timings,
  heapAfterForcedGc_bytes: heapSamples,
  heapDelta_bytes: heapSamples.at(-1) - heapSamples[0],
  note: "GC-assisted Node diagnostics; not browser leak certification."
};
await mkdir(resolve(output, ".."), { recursive: true });
await writeFile(output, JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify({
  fixture: result.fixture, p50_ms: result.p50_ms, p95_ms: result.p95_ms,
  heapDelta_bytes: result.heapDelta_bytes, cleanupsVerified: result.cleanupCount,
  postDisposeRuns
}, null, 2));