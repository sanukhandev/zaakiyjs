import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
const directory = resolve(process.argv[2] ?? "benchmark-artifacts");
const read = async file => JSON.parse(await readFile(resolve(directory, file), "utf8"));
const before = await read("signals-tracking-frozen.json");
const after = await read("signals-tracking-candidate.json");
if (before.schemaVersion !== 1 || after.schemaVersion !== 1 ||
    before.fixture !== after.fixture || before.modes.length !== 2 ||
    after.modes.length !== 2) throw new Error("Incompatible signal tracking benchmarks");
const lines = [
  "# B7 — Direct signal tracking allocation probe",
  "",
  "Frozen consolidated B0–B5 runtime vs candidate on identical 400-subscriber, 150-update workloads; 2 warmups and 12 recorded samples.",
  "",
  "| Mode | Frozen p50 | Candidate p50 | Candidate change | Frozen p95 | Candidate p95 |",
  "| --- | ---: | ---: | ---: | ---: | ---: |"
];
for (let i = 0; i < 2; i++) {
  const a = before.modes[i], b = after.modes[i];
  if (a.mode !== b.mode || a.fanout !== b.fanout || a.updates !== b.updates ||
      a.expectedCallsPerSample !== b.expectedCallsPerSample ||
      a.postDisposeRuns !== 0 || b.postDisposeRuns !== 0 ||
      a.samples_ms.length !== 12 || b.samples_ms.length !== 12 ||
      ![a.p50_ms,a.p95_ms,b.p50_ms,b.p95_ms].every(Number.isFinite)) {
    throw new Error("Missing correctness or timing evidence for " + a.mode);
  }
  lines.push("| "+a.mode+" | "+a.p50_ms.toFixed(2)+" ms | "+
    b.p50_ms.toFixed(2)+" ms | "+((b.p50_ms/a.p50_ms-1)*100).toFixed(1)+"% | "+
    a.p95_ms.toFixed(2)+" ms | "+b.p95_ms.toFixed(2)+" ms |");
}
lines.push("", "These are isolated Node workloads, not browser INP or overall framework speed. Repeat independently and reject the change if no consistent benefit is measured.", "");
await mkdir(directory, { recursive: true });
await writeFile(resolve(directory, "signals-tracking-report.md"), lines.join("\n"));
console.log(lines.join("\n"));