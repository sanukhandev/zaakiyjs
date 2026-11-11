import {performance} from "node:perf_hooks";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {writeFile, mkdir} from "node:fs/promises";

const root = resolve(process.argv[2] ?? ".");
const output = process.argv[3] ?? "benchmark-artifacts/router.json";
const {compileRoutes, matchRoutes} =
  await import(pathToFileURL(resolve(root, "packages/router/dist/index.js")).href);
const routeCount = 512;
const table = compileRoutes([{
  id: "root", path: "/", children: [{
    id: "company", path: "companies/:company", children: Array.from(
      {length: routeCount}, (_, i) => ({
        id: "product-" + i, path: "products/p" + i + "/:sku"
      }))
  }]
}]);
const warmups = 3;
const repetitions = 20;
const matchesPerBatch = 800;
const samples = [];
let verified = 0;
for (let i = -warmups; i < repetitions; i++) {
  const start = performance.now();
  for (let j = 0; j < matchesPerBatch; j++) {
    const idx = ((j + i * 13) % routeCount + routeCount) % routeCount;
    const expected = String(idx);
    const route = matchRoutes(table, "/companies/acme/products/p" + idx + "/sku-" + idx);
    if (route.length !== 3 || route[0]?.route.id !== "root" ||
        route[1]?.params.company !== "acme" || route[2]?.params.company !== "acme" ||
        route[2]?.params.sku !== "sku-" + expected ||
        route[2]?.route.id !== "product-" + idx ||
        Object.hasOwn(route[1]?.params ?? {}, "sku")) {
      throw new Error("Router benchmark violated nested match contract at " + idx);
    }
    verified++;
  }
  if (i >= 0) samples.push((performance.now() - start) / matchesPerBatch);
}
const ordered = samples.toSorted((a, b) => a - b);
const percentile = fraction => {
  const idx = (ordered.length - 1) * fraction;
  const lower = Math.floor(idx), upper = Math.ceil(idx);
  return ordered[lower] + (ordered[upper] - ordered[lower]) * (idx - lower);
};
const data = {
  schemaVersion: 1, node: process.version,
  routes: table.routes.length, warmups, repetitions, matchesPerBatch,
  verifiedMatches: verified,
  p50_ms_per_match: percentile(0.5),
  p95_ms_per_match: percentile(0.95),
  samples_ms_per_match: samples
};
await mkdir(resolve(output, ".."), {recursive: true});
await writeFile(output, JSON.stringify(data, null, 2) + "\n");
console.log(JSON.stringify({routes: data.routes, verifiedMatches: verified,
  p50_ms_per_match: data.p50_ms_per_match,
  p95_ms_per_match: data.p95_ms_per_match}, null, 2));
