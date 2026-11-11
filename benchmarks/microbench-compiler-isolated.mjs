import {performance} from "node:perf_hooks";
import {createHash} from "node:crypto";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {mkdir, writeFile} from "node:fs/promises";
const root = resolve(process.argv[2] ?? ".");
const output = process.argv[3] ?? "benchmark-artifacts/compiler-probe.json";
const {compile} = await import(pathToFileURL(resolve(root, "packages/compiler/dist/index.js")).href);
const fileName = resolve(root, "packages/compiler/test/__perf_virtual.tsx");
const source = [
  "declare function signal<T>(initial:T): {value:T};",
  "interface Entry { id:number; label:string }",
  "function Counter() {",
  "  const count = signal(0);",
  "  const heading = 'Benchmark';",
  "  return <main><h1>{heading}</h1><output>{count.value}</output><button onClick={() => count.value++}>Increment</button></main>;",
  "}"
].join("\n");
const request = {fileName, source};
const warmups = 3, repetitions = 16;
const samples = [];
const hashes = new Set();
for (let i = -warmups; i < repetitions; i++) {
  const start = performance.now();
  const compiled = compile(request);
  const elapsed = performance.now() - start;
  if (compiled.diagnostics.some(d => d.severity === "error") || !compiled.js[0]?.code) {
    throw new Error("Compiler probe fixture compilation failed: " +
      JSON.stringify(compiled.diagnostics));
  }
  hashes.add(createHash("sha256").update(compiled.js[0].code).digest("hex"));
  if (i >= 0) samples.push(elapsed);
}
if (hashes.size !== 1) throw new Error("Non-deterministic compiler output");
const ordered = samples.toSorted((a, b) => a - b);
const percentile = f => {
  const n = (ordered.length - 1) * f, l = Math.floor(n), h = Math.ceil(n);
  return ordered[l] + (ordered[h] - ordered[l]) * (n - l);
};
const result = {
  schemaVersion: 1, node: process.version, warmups, repetitions,
  sha256: [...hashes][0],
  p50_ms: percentile(0.5), p95_ms: percentile(0.95), samples_ms: samples
};
await mkdir(resolve(output, ".."), {recursive: true});
await writeFile(output, JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify({p50_ms: result.p50_ms, p95_ms: result.p95_ms, repetitions}, null, 2));
