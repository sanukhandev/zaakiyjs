import { performance } from "node:perf_hooks";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";

const root = resolve(process.argv[2] ?? ".");
const output = resolve(process.argv[3] ?? "benchmark-artifacts/keyed-equal.json");
const requireFromDom = createRequire(pathToFileURL(join(root, "packages/dom/package.json")));
const { JSDOM } = requireFromDom("jsdom");
const { createOwner, disposeOwner, mountOwner } =
  await import(pathToFileURL(join(root, "packages/core/dist/index.js")).href);
const { bindKeyedRegion, createRegion } =
  await import(pathToFileURL(join(root, "packages/dom/dist/compiler.js")).href);
const { signal, flushSync } =
  await import(pathToFileURL(join(root, "packages/signals/dist/index.js")).href);

function percentile(items, fraction) {
  const sorted = [...items].sort((a, b) => a - b);
  const at = (sorted.length - 1) * fraction;
  const low = Math.floor(at), high = Math.ceil(at);
  return sorted[low] + (sorted[high] - sorted[low]) * (at - low);
}
function sample(count, iterations) {
  const dom = new JSDOM("<!doctype html><body></body>");
  const oldDocument = globalThis.document;
  globalThis.document = dom.window.document;
  let owner;
  try {
    const host = dom.window.document.createElement("div");
    dom.window.document.body.append(host);
    const values = signal(Array.from({ length: count }, (_, id) => ({ id })));
    let initialized = 0;
    owner = createOwner();
    bindKeyedRegion(owner, createRegion(host), () => values.value,
      row => row.id, row => {
        initialized++;
        const node = dom.window.document.createElement("span");
        node.dataset.id = String(row.id);
        return { node };
      });
    mountOwner(owner);
    if (initialized !== count) throw new Error("Initial row creation mismatch");
    const original = [...host.querySelectorAll("span")];
    const mutationObserver = new dom.window.MutationObserver(() => {});
    mutationObserver.observe(host, { childList: true, subtree: true });
    const began = performance.now();
    for (let i = 0; i < iterations; i++) {
      values.value = [...values.value];
      flushSync();
    }
    const elapsed = performance.now() - began;
    const mutations = mutationObserver.takeRecords().length;
    mutationObserver.disconnect();
    const ending = [...host.querySelectorAll("span")];
    if (mutations !== 0 || ending.length !== count ||
        ending.some((node, index) => node !== original[index]) ||
        initialized !== count) {
      throw new Error("Equal-snapshot reconciliation modified DOM or retained identities");
    }
    return { elapsed, checksum: createHash("sha256")
      .update(ending.map(node => node.dataset.id).join(",")).digest("hex") };
  } finally {
    if (owner) disposeOwner(owner);
    dom.window.close();
    globalThis.document = oldDocument;
  }
}
const scenarios = [];
for (const count of [100, 1000]) {
  const iterations = count === 100 ? 200 : 100;
  for (let i = 0; i < 2; i++) sample(count, iterations);
  const times = [];
  let checksum;
  for (let i = 0; i < 7; i++) {
    const result = sample(count, iterations);
    if (checksum && result.checksum !== checksum) throw new Error("Fixture identity drift");
    checksum = result.checksum;
    times.push(result.elapsed / iterations);
  }
  scenarios.push({
    rows: count, iterations, warmups: 2, samples: 7,
    p50_ms_per_update: percentile(times, .5),
    p95_ms_per_update: percentile(times, .95),
    raw_ms_per_update: times,
    identitySha256: checksum,
    mutations: 0
  });
}
const report = { schemaVersion: 1, fixture: "equal-keyed-snapshots-v1",
  root, node: process.version, scenarios };
await mkdir(resolve(output, ".."), { recursive: true });
await writeFile(output, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(scenarios.map(x => ({
  rows: x.rows, p50: x.p50_ms_per_update, p95: x.p95_ms_per_update
})), null, 2));