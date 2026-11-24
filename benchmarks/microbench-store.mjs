import {performance} from "node:perf_hooks";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {writeFile, mkdir} from "node:fs/promises";
const root = resolve(process.argv[2] ?? ".");
const output = process.argv[3] ?? "benchmark-artifacts/store.json";
const {createOwner, disposeOwner} = await import(
  pathToFileURL(resolve(root, "packages/core/dist/index.js")).href);
const {createStore} = await import(
  pathToFileURL(resolve(root, "packages/store/dist/index.js")).href);
const owner = createOwner();
const store = createStore({
  owner,
  state: {count: 0, profile: {name: "Example", visible: true}},
  actions: write => ({
    increment() {write.update("count", previous => previous + 1);},
    changeName(name) {write.update("profile", previous => ({...previous, name}));}
  })
});
const warmups = 3, repetitions = 20, actionsPerBatch = 1000;
let expectedCount = 0;
const samples = [];
try {
  for (let i = -warmups; i < repetitions; i++) {
    const start = performance.now();
    for (let j = 0; j < actionsPerBatch; j++) {
      store.actions.increment();
      expectedCount++;
    }
    const elapsed = (performance.now() - start) / actionsPerBatch;
    store.actions.changeName("round-" + i);
    if (store.state.count.value !== expectedCount ||
        store.state.profile.value.name !== "round-" + i ||
        !Object.isFrozen(store.state.profile.value)) {
      throw new Error("Store benchmark broke state or immutability semantics");
    }
    if (i >= 0) samples.push(elapsed);
  }
} finally {store.dispose(); disposeOwner(owner);}
const ordered = samples.toSorted((a, b) => a - b);
const percentile = fraction => {
  const p = (ordered.length - 1) * fraction, lo = Math.floor(p), hi = Math.ceil(p);
  return ordered[lo] + (ordered[hi] - ordered[lo]) * (p - lo);
};
const data = {
  schemaVersion: 1, node: process.version, actionsPerBatch, repetitions, warmups,
  validatedActions: expectedCount,
  p50_ms_per_action: percentile(0.5), p95_ms_per_action: percentile(0.95),
  samples_ms_per_action: samples
};
await mkdir(resolve(output, ".."), {recursive: true});
await writeFile(output, JSON.stringify(data, null, 2) + "\n");
console.log(JSON.stringify({validatedActions: expectedCount,
  p50_ms_per_action: data.p50_ms_per_action,
  p95_ms_per_action: data.p95_ms_per_action}, null, 2));
