import {performance} from "node:perf_hooks";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {writeFile, mkdir} from "node:fs/promises";

const root = resolve(process.argv[2] ?? ".");
const output = process.argv[3] ?? "benchmark-artifacts/router.json";
const {compileRoutes, matchRoutes} =
  await import(pathToFileURL(resolve(root, "packages/router/dist/index.js")).href);

function scenario(table, getPath, validate) {
  const warmups = 3, repetitions = 20, matchesPerBatch = 800;
  const samples = [];
  for (let i = -warmups; i < repetitions; i++) {
    const start = performance.now();
    for (let j = 0; j < matchesPerBatch; j++) {
      const idx = ((j + i * 13) % 512 + 512) % 512;
      const routes = matchRoutes(table, getPath(idx));
      if (!validate(routes, idx)) throw new Error("Router nested match contract failed: " + idx);
    }
    if (i >= 0) samples.push((performance.now() - start) / matchesPerBatch);
  }
  const sorted = samples.toSorted((a, b) => a - b);
  const percentile = fraction => {
    const p = (sorted.length - 1) * fraction;
    const low = Math.floor(p), high = Math.ceil(p);
    return sorted[low] + (sorted[high] - sorted[low]) * (p - low);
  };
  return {
    routes: table.routes.length, warmups, repetitions, matchesPerBatch,
    validatedMatches: (warmups + repetitions) * matchesPerBatch,
    p50_ms_per_match: percentile(0.5),
    p95_ms_per_match: percentile(0.95),
    samples_ms_per_match: samples
  };
}

const table = compileRoutes([{
  id: "root", path: "/", children: [{
    id: "company", path: "companies/:company", children: Array.from(
      {length: 512}, (_, i) => ({
        id: "product-" + i, path: "products/p" + i + "/:sku"
      }))
  }]
}]);
const broad = scenario(
  table, idx => "/companies/acme/products/p" + idx + "/sku-" + idx,
  (routes, idx) => routes.length === 3 && routes[0]?.route.id === "root" &&
    routes[1]?.params.company === "acme" &&
    routes[2]?.params.company === "acme" &&
    routes[2]?.params.sku === "sku-" + idx &&
    routes[2]?.route.id === "product-" + idx &&
    !Object.hasOwn(routes[1]?.params ?? {}, "sku")
);

const depth = 10;
const base = Array.from({length: depth}, (_, i) => "segment" + i + "/:p" + i);
const leaves = Array.from({length: 32}, (_, i) => ({
  id: "deep-leaf-" + i, path: "products/p" + i + "/:sku"
}));
let nested = {id: "layer-" + (depth - 1), path: base[depth - 1], children: leaves};
for (let i = depth - 2; i >= 0; i--) {
  nested = {id: "layer-" + i, path: base[i], children: [nested]};
}
const deepTable = compileRoutes([nested]);
const prefix = "/" + Array.from({length: depth}, (_, i) =>
  "segment" + i + "/value" + i).join("/");
const deep = scenario(
  deepTable, idx => prefix + "/products/p" + (idx % 32) + "/sku-" + idx,
  (routes, idx) => routes.length === depth + 1 &&
    routes[0]?.params.p0 === "value0" &&
    routes[depth - 1]?.params.p9 === "value9" &&
    !Object.hasOwn(routes[depth - 1]?.params ?? {}, "sku") &&
    routes[depth]?.params.p0 === "value0" &&
    routes[depth]?.params.p9 === "value9" &&
    routes[depth]?.params.sku === "sku-" + idx &&
    routes[depth]?.route.id === "deep-leaf-" + (idx % 32)
);
const report = {
  schemaVersion: 2, node: process.version, root,
  scenarios: {broad, deep},
  // Preserve original report fields for compatibility with earlier consumers.
  ...broad
};
await mkdir(resolve(output, ".."), {recursive: true});
await writeFile(output, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({
  broad: {routes: broad.routes, p50_ms: broad.p50_ms_per_match,
    p95_ms: broad.p95_ms_per_match},
  deep: {routes: deep.routes, p50_ms: deep.p50_ms_per_match,
    p95_ms: deep.p95_ms_per_match}
}, null, 2));
