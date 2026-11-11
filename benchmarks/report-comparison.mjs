import {readFile, writeFile} from "node:fs/promises";

const timing = JSON.parse(await readFile("benchmark-artifacts/browser-results.json", "utf8"));
const bundle = JSON.parse(await readFile("benchmark-artifacts/bundle-sizes.json", "utf8"));
const columns = ["counter", "rename", "reverse", "toggle", "swap", "rotate", "append", "prepend", "removeMiddle"];
const lines = [
  "# Production benchmark: React vs ZaakiyJS frozen main vs candidate",
  "",
  "React 19.2.4, Node 22, Vite 6.4.5, production builds; 1,000 keyed rows; pinned baseline `" + timing.baselineCommit + "`.",
  "Time is milliseconds. Ratios greater than 1 mean candidate slower than the comparator; values below timer resolution are marked n/a.",
  ""
];
function ratio(value, comparator) {
  return value > 0 && comparator >= 0.01
    ? (value / comparator).toFixed(2) + "×" : "n/a";
}
for (const [engine, record] of Object.entries(timing.browsers)) {
  const {react, baseline, hardening, candidate} = record.variants;
  if (!react || !baseline || !hardening || !candidate) throw new Error("Missing benchmark framework for " + engine);
  lines.push("## " + engine + " " + record.version, "");
  lines.push("| Operation | React p50 | Main p50 | Hardening p50 | PR p50 | PR / React | PR / Main | PR / Hardening | React p95 | Main p95 | Hardening p95 | PR p95 | PR p99 |");
  lines.push("| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |");
  for (const name of columns) {
    const a = candidate.operations[name], b = baseline.operations[name], c = react.operations[name], d = hardening.operations[name];
    if (!a || !b || !c || !d || a.n !== timing.samples || b.n !== timing.samples || c.n !== timing.samples || d.n !== timing.samples) {
      throw new Error("Missing samples or case " + engine + " " + name);
    }
    lines.push("| " + name + " | " + c.p50_ms.toFixed(3) + " | " + b.p50_ms.toFixed(3) +
      " | " + d.p50_ms.toFixed(3) + " | " + a.p50_ms.toFixed(3) +
      " | " + ratio(a.p50_ms, c.p50_ms) + " | " + ratio(a.p50_ms, b.p50_ms) +
      " | " + ratio(a.p50_ms, d.p50_ms) + " | " + c.p95_ms.toFixed(3) +
      " | " + b.p95_ms.toFixed(3) + " | " + d.p95_ms.toFixed(3) +
      " | " + a.p95_ms.toFixed(3) + " | " + a.p99_ms.toFixed(3) + " |");
  }
  lines.push("");
}
lines.push("## Emitted production JS/CSS totals", "",
  "| Framework | Raw bytes | Gzip bytes | Brotli bytes |",
  "| --- | ---: | ---: | ---: |");
for (const name of ["react", "baseline", "hardening", "candidate"]) {
  const value = bundle.assets[name]?.totals;
  if (!value || !Number.isFinite(value.raw) || !Number.isFinite(value.gzip) ||
      !Number.isFinite(value.brotli)) throw new Error("Missing bundle size for " + name);
  lines.push("| " + name + " | " + value.raw + " | " + value.gzip + " | " + value.brotli + " |");
}
const packages = JSON.parse(await readFile("benchmark-artifacts/package-sizes.json", "utf8"));
lines.push("## Compiled-package footprint by package", "",
  "Individually compressed JS/CSS files, **not** browser chunk size or an npm release artifact.", "",
  "| Package | Main gzip | Hardening gzip | Candidate gzip | Change vs hardening |",
  "| --- | ---: | ---: | ---: | ---: |");
for (const row of packages.packages) {
  lines.push("| " + row.package + " | " + row.baseline.gzip + " | " +
    row.hardening.gzip + " | " + row.candidate.gzip + " | " +
    row.hardeningGzipDelta + " |");
}
lines.push("", "## Isolated runtime and compiler microbenchmarks", "",
  "Same-run synthetic diagnostics; no cross-host performance guarantee.", "",
  "| Scenario | Main | Hardening | Candidate | Unit |",
  "| --- | ---: | ---: | ---: | --- |");
for (const name of ["core", "compiler"]) {
  const variants = await Promise.all(["main", "hardening", "candidate"].map(
    suffix => readFile("benchmark-artifacts/" + name + "-" + suffix + ".json", "utf8")
      .then(JSON.parse)));
  lines.push("| " + name + " p50 | " +
    variants.map(item => item.p50_ms.toFixed(3)).join(" | ") + " | ms |");
}
const routerRuns = await Promise.all(["main", "hardening", "candidate"].map(
  suffix => readFile("benchmark-artifacts/router-" + suffix + ".json", "utf8")
    .then(JSON.parse)));
lines.push("| router / 514-route match p50 | " +
  routerRuns.map(item => item.p50_ms_per_match.toFixed(5)).join(" | ") + " | ms/match |");
const signalRuns = await Promise.all(["main", "hardening", "candidate"].map(
  suffix => readFile("benchmark-artifacts/signals-" + suffix + ".json", "utf8")
    .then(JSON.parse)));
lines.push("| signals 5,000 flushes | " +
  signalRuns.map(item => item.elapsedMs.toFixed(3)).join(" | ") + " | ms |", "");
lines.push("", "Raw samples and host/browser metadata are in the JSON artifacts. This is not LCP/FCP, real-user monitoring or a universal framework ranking. Timer granularity in Firefox/WebKit makes short operation ratios uninterpretable; use robust multi-operation batches before enforcing those latencies.");
await writeFile("benchmark-artifacts/summary.md", lines.join("\n") + "\n");
console.log("Wrote benchmark-artifacts/summary.md");