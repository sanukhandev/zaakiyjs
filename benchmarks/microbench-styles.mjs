import {performance} from "node:perf_hooks";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {writeFile, mkdir} from "node:fs/promises";
import {createHash} from "node:crypto";

const root = resolve(process.argv[2] ?? ".");
const output = process.argv[3] ?? "benchmark-artifacts/styles.json";
const {defineBrand, compileStyles} =
  await import(pathToFileURL(resolve(root, "packages/styles/dist/index.js")).href);
const config = {
  brand: defineBrand({
    identity: {name: "Benchmark", slug: "benchmark"},
    colors: {primary: "#123456", success: "#15803d"},
    appearance: {dark: {colors: {primary: "#abcdef"}}},
    motion: {durations: {fast: "100ms"}}
  }),
  mode: "system"
};
const utilities = [
  "flex", "grid", "grid-cols-3", "gap-4", "p-4", "mx-auto", "h-full",
  "w-1/2", "text-center", "text-xl", "font-bold", "rounded-lg",
  "border-primary", "shadow-sm", "opacity-50", "relative",
  "bg-primary", "hover:bg-primary", "md:grid-cols-2", "dark:bg-primary"
];
const tokenCount = 4000;
const tokens = Array.from({length: tokenCount}, (_, i) => ({
  token: utilities[i % utilities.length], file: "app.tsx", offset: i * 12
}));
const request = {config, tokens, minify: true};
const warmups = 3, repetitions = 20;
const samples = [];
const hashes = new Set();
for (let i = -warmups; i < repetitions; i++) {
  const start = performance.now();
  const result = compileStyles(request);
  const elapsed = performance.now() - start;
  if (result.diagnostics.some(d => d.severity === "error") || !result.css.includes(".flex{")) {
    throw new Error("Styles benchmark produced invalid stylesheet: " +
      JSON.stringify(result.diagnostics));
  }
  hashes.add(createHash("sha256").update(result.css).digest("hex"));
  if (i >= 0) samples.push(elapsed);
}
if (hashes.size !== 1) throw new Error("Styles output is non-deterministic");
const ordered = samples.toSorted((a, b) => a - b);
const percentile = fraction => {
  const p = (ordered.length - 1) * fraction, lo = Math.floor(p), hi = Math.ceil(p);
  return ordered[lo] + (ordered[hi] - ordered[lo]) * (p - lo);
};
const result = {
  schemaVersion: 1, node: process.version, inputTokenCount: tokenCount,
  uniqueTokenCount: utilities.length, repetitions, warmups,
  stableCssSha256: [...hashes][0],
  p50_ms: percentile(0.5), p95_ms: percentile(0.95),
  samples_ms: samples
};
await mkdir(resolve(output, ".."), {recursive: true});
await writeFile(output, JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify({inputTokenCount: tokenCount,
  p50_ms: result.p50_ms, p95_ms: result.p95_ms}, null, 2));
