import {readFile, writeFile} from "node:fs/promises";

const timing = JSON.parse(await readFile("benchmark-artifacts/browser-results.json", "utf8"));
const bundle = JSON.parse(await readFile("benchmark-artifacts/bundle-sizes.json", "utf8"));
const columns = ["counter", "rename", "reverse", "toggle"];
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
  const {react, baseline, candidate} = record.variants;
  if (!react || !baseline || !candidate) throw new Error("Missing benchmark framework for " + engine);
  lines.push("## " + engine + " " + record.version, "");
  lines.push("| Operation | React p50 | Main p50 | PR p50 | PR / React | PR / Main | PR p95 |");
  lines.push("| --- | ---: | ---: | ---: | ---: | ---: | ---: |");
  for (const name of columns) {
    const a = candidate.operations[name], b = baseline.operations[name], c = react.operations[name];
    if (!a || !b || !c || a.n !== timing.samples || b.n !== timing.samples || c.n !== timing.samples) {
      throw new Error("Missing samples or case " + engine + " " + name);
    }
    lines.push("| " + name + " | " + c.p50_ms.toFixed(3) + " | " + b.p50_ms.toFixed(3) +
      " | " + a.p50_ms.toFixed(3) + " | " + ratio(a.p50_ms, c.p50_ms) +
      " | " + ratio(a.p50_ms, b.p50_ms) + " | " + a.p95_ms.toFixed(3) + " |");
  }
  lines.push("");
}
lines.push("## Emitted production JS/CSS totals", "",
  "| Framework | Raw bytes | Gzip bytes | Brotli bytes |",
  "| --- | ---: | ---: | ---: |");
for (const name of ["react", "baseline", "candidate"]) {
  const value = bundle.assets[name]?.totals;
  if (!value || !Number.isFinite(value.raw) || !Number.isFinite(value.gzip) ||
      !Number.isFinite(value.brotli)) throw new Error("Missing bundle size for " + name);
  lines.push("| " + name + " | " + value.raw + " | " + value.gzip + " | " + value.brotli + " |");
}
lines.push("", "Raw samples and host/browser metadata are in the JSON artifacts. This is not LCP/FCP, real-user monitoring or a universal framework ranking. Timer granularity in Firefox/WebKit makes short operation ratios uninterpretable; use robust multi-operation batches before enforcing those latencies.");
await writeFile("benchmark-artifacts/summary.md", lines.join("\n") + "\n");
console.log("Wrote benchmark-artifacts/summary.md");
