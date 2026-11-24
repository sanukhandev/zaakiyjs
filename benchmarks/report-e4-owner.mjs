import { readFile, writeFile } from "node:fs/promises";
const base = JSON.parse(await readFile("benchmark-artifacts/e4-core-before.json", "utf8"));
const now = JSON.parse(await readFile("benchmark-artifacts/e4-core-after.json", "utf8"));
if (base.schemaVersion !== 1 || now.schemaVersion !== 1 ||
    base.childrenPerCycle !== now.childrenPerCycle || base.repetitions !== now.repetitions ||
    base.callbacksVerified !== now.callbacksVerified ||
    base.samples_ms.length !== 30 || now.samples_ms.length !== 30 ||
    ![base.p50_ms, base.p95_ms, now.p50_ms, now.p95_ms].every(Number.isFinite)) {
  throw new Error("Missing comparable owner-lifecycle performance evidence");
}
const improvement = (1 - now.p50_ms/base.p50_ms)*100;
const lines = [
  "# E4 — Lazy owner child-set allocation",
  "",
  "Frozen pre-E4 and candidate implementations each create and dispose 2,000 child owners per cycle, 30 measured samples, 5 warmups.",
  "",
  "| Measure | Pre-E4 baseline | Candidate |",
  "| --- | ---: | ---: |",
  "| Cycle p50 | "+base.p50_ms.toFixed(3)+" ms | "+now.p50_ms.toFixed(3)+" ms |",
  "| Cycle p95 | "+base.p95_ms.toFixed(3)+" ms | "+now.p95_ms.toFixed(3)+" ms |",
  "| Cleanup callbacks verified | "+base.callbacksVerified+" | "+now.callbacksVerified+" |",
  "",
  "Candidate p50 change: "+improvement.toFixed(1)+"% faster (positive) or slower (negative).",
  "A single Node runner is diagnostic. No universal speedup or retained-heap certification is claimed without repeat runs.",
  ""
];
await writeFile("benchmark-artifacts/e4-core-comparison.md",lines.join("\n"));
console.log(lines.join("\n"));