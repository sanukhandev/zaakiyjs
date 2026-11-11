import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const directory = resolve(process.argv[2] ?? "benchmark-artifacts");
const read = async file => JSON.parse(await readFile(resolve(directory, file), "utf8"));
const baseline = await read("owner-retention-hardening.json");
const candidate = await read("owner-retention-candidate.json");
for (const [name, record] of [["hardening", baseline], ["candidate", candidate]]) {
  if (record.schemaVersion !== 1 ||
      record.fixture !== "owner-effect-dispose-200-v1" ||
      record.measuredCycles !== 160 ||
      !Array.isArray(record.timings_ms) ||
      record.timings_ms.length !== record.measuredCycles ||
      !Array.isArray(record.heapAfterForcedGc_bytes) ||
      record.heapAfterForcedGc_bytes.length !== record.checkpoints + 1 ||
      record.cleanupCount !== record.expectedCleanups ||
      record.effectRuns !== record.expectedRuns ||
      record.postDisposeRuns !== 0 ||
      ![record.p50_ms, record.p95_ms, record.heapDelta_bytes].every(Number.isFinite)) {
    throw new Error("Invalid B6 owner retention evidence for " + name);
  }
}
const format = n => n.toFixed(3);
const lines = [
  "# B6 — Owner/effect retention benchmark",
  "",
  "Both implementations execute the same 200-child lifecycle fixture with 160 measured cycles, plus 4 warmups, under Node --expose-gc.",
  "",
  "| Metric | Frozen hardening | Candidate |",
  "| --- | ---: | ---: |",
  "| Cycle p50 | " + format(baseline.p50_ms) + " ms | " + format(candidate.p50_ms) + " ms |",
  "| Cycle p95 | " + format(baseline.p95_ms) + " ms | " + format(candidate.p95_ms) + " ms |",
  "| After-GC heap delta | " + baseline.heapDelta_bytes + " bytes | " + candidate.heapDelta_bytes + " bytes |",
  "| Owned cleanups | " + baseline.cleanupCount + " | " + candidate.cleanupCount + " |",
  "| Effect runs after disposal | " + baseline.postDisposeRuns + " | " + candidate.postDisposeRuns + " |",
  "",
  "The heap deltas are noisy diagnostics from one Node process per variant, not a release-gating leak threshold or real-browser memory proof.",
  "No speedup is claimed until independent repetitions and confidence analysis.",
  ""
];
await mkdir(directory, { recursive: true });
await writeFile(resolve(directory, "owner-retention-comparison.md"), lines.join("\n"));
console.log(lines.join("\n"));