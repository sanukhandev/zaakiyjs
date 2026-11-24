import { readFile, writeFile } from "node:fs/promises";
const read = async name => JSON.parse(await readFile("benchmark-artifacts/" + name, "utf8"));
const [baseline, candidate] = await Promise.all([
  read("keyed-equal-baseline.json"), read("keyed-equal-candidate.json")
]);
if (baseline.schemaVersion !== 1 || candidate.schemaVersion !== 1 ||
    baseline.fixture !== candidate.fixture || baseline.scenarios.length !== 2 ||
    candidate.scenarios.length !== 2) {
  throw new Error("Incomplete equal-keyed-snapshot benchmark");
}
const lines = ["# E3 — Equal-keyed-snapshot DOM fast path",
  "", "Identical Node 22/jsdom workloads; existing hardened DOM versus optimized candidate.",
  "Seven measured samples after two warmups, isolated instances; source-array copies preserve all keys and item identities.",
  "", "| Rows | Baseline p50/update | Candidate p50/update | Change | Baseline p95 | Candidate p95 |",
  "| ---: | ---: | ---: | ---: | ---: | ---: |"];
for (let i = 0; i < 2; i++) {
  const a = baseline.scenarios[i], b = candidate.scenarios[i];
  if (a.rows !== b.rows || a.iterations !== b.iterations ||
      a.identitySha256 !== b.identitySha256 || a.mutations !== 0 || b.mutations !== 0 ||
      a.raw_ms_per_update.length !== 7 || b.raw_ms_per_update.length !== 7 ||
      ![a.p50_ms_per_update, b.p50_ms_per_update, a.p95_ms_per_update, b.p95_ms_per_update]
        .every(Number.isFinite)) throw new Error("DOM benchmark parity failed");
  const pct = (b.p50_ms_per_update/a.p50_ms_per_update - 1) * 100;
  lines.push("| "+a.rows+" | "+a.p50_ms_per_update.toFixed(4)+" ms | "+
    b.p50_ms_per_update.toFixed(4)+" ms | "+pct.toFixed(1)+"% | "+
    a.p95_ms_per_update.toFixed(4)+" ms | "+b.p95_ms_per_update.toFixed(4)+" ms |");
}
lines.push("", "Diagnostic Node/jsdom benchmark only. It does not measure Firefox reversal or prove universal DOM performance. Full browser CI retains correctness authority.", "");
await writeFile("benchmark-artifacts/keyed-equal-comparison.md", lines.join("\n"));
console.log(lines.join("\n"));