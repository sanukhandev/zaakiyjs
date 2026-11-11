import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
const dir = resolve(process.argv[2] ?? "benchmark-artifacts");
const read = async file => JSON.parse(await readFile(resolve(dir, file), "utf8"));
const frozen = await read("b8-vite-frozen.json");
const candidate = await read("b8-vite-candidate.json");
if (frozen.schemaVersion !== 1 || candidate.schemaVersion !== 1 ||
    frozen.scenarios.length !== 3 || candidate.scenarios.length !== 3) {
  throw new Error("Missing Vite phase benchmark scenarios");
}
const lines = [
  "# B8 — Vite build phase profiling",
  "",
  "Same-run pinned Vite production builds for both the frozen B0–B5 consolidated implementation and PR candidate.",
  "Per-case plugin timings include actual TSX transformations and the generateBundle hook, not all Vite/Rollup work.",
  "",
  "| TSX modules | Frozen total p50 | Candidate total p50 | Candidate TSX transform p50 | Candidate CSS/manifest generation p50 |",
  "| ---: | ---: | ---: | ---: | ---: |"
];
for (let i = 0; i < 3; i++) {
  const b = frozen.scenarios[i], c = candidate.scenarios[i];
  if (![1,8,24].includes(c.modules) || c.modules !== b.modules ||
      b.assetSha256 !== c.assetSha256 ||
      b.appJsCssGzipBytes !== c.appJsCssGzipBytes) {
    throw new Error("B8 production assets or benchmark fixtures differ");
  }
  for (const record of [b,c]) {
    if (!Number.isFinite(record.p50_ms) || !Number.isFinite(record.p95_ms) ||
        !Number.isFinite(record.transformP50_ms) ||
        !Number.isFinite(record.cssGenerationP50_ms) ||
        record.profiles.length !== 4 ||
        record.transformCalls.some(count => count !== record.modules) ||
        record.cssGenerationCalls.some(count => count !== 1)) {
      throw new Error("Invalid B8 phase instrumentation for " + record.modules);
    }
  }
  lines.push("| "+c.modules+" | "+b.p50_ms.toFixed(1)+" ms | "+
    c.p50_ms.toFixed(1)+" ms | "+c.transformP50_ms.toFixed(1)+" ms | "+
    c.cssGenerationP50_ms.toFixed(1)+" ms |");
}
lines.push("", "All output hashes and gzip byte counts match. Phase totals overlap other build work and are *not* additive to wall time.",
  "The candidate can differ from the frozen reference: report speedups only with matching output hashes and repeated independent evidence. HMR latency is not measured by this production-build fixture.", "");
await mkdir(dir, { recursive: true });
await writeFile(resolve(dir, "b8-vite-phase-report.md"), lines.join("\n"));
console.log(lines.join("\n"));