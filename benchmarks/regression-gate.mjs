import {readFileSync} from "node:fs";

const data = JSON.parse(readFileSync("benchmark-artifacts/browser-results.json", "utf8"));
const bundles = JSON.parse(readFileSync("benchmark-artifacts/bundle-sizes.json", "utf8"));
const failures = [];
for (const name of ["chromium", "firefox", "webkit"]) {
  const variants = data.browsers[name]?.variants;
  if (!variants) { failures.push("No browser evidence: " + name); continue; }
  const results = ["react", "baseline", "candidate"].map(framework => variants[framework]?.operations?.reverse);
  if (results.some(value => !value || value.n !== data.samples ||
      !Number.isFinite(value.p95_ms) || !Number.isFinite(value.p50_ms))) {
    failures.push("Missing/invalid reverse p50/p95 and samples for " + name);
    continue;
  }
  const [react, baseline, candidate] = results;
  // Calibrated against the frozen-main/React reference on the same runner.
  // Slack is intentional: GitHub-hosted runners and browser timers are noisy.
  const reactLimit = react.p95_ms * 2 + 10;
  const baselineLimit = baseline.p95_ms * 1.5 + 10;
  const limit = Math.min(reactLimit, baselineLimit);
  console.log(name + " reverse p95: PR " + candidate.p95_ms.toFixed(3) +
    "ms; React " + react.p95_ms.toFixed(3) + "ms; main " +
    baseline.p95_ms.toFixed(3) + "ms; threshold " + limit.toFixed(3) + "ms");
  if (candidate.p95_ms > limit) {
    failures.push(name + " keyed reorder p95 exceeds reviewed reference/main threshold");
  }
}
const baselineGzip = bundles.assets.baseline?.totals?.gzip;
const candidateGzip = bundles.assets.candidate?.totals?.gzip;
if (!Number.isFinite(baselineGzip) || !Number.isFinite(candidateGzip) ||
    baselineGzip <= 0 || candidateGzip <= 0) {
  failures.push("Missing production JS/CSS gzip evidence");
} else {
  const max = baselineGzip * 1.1 + 512;
  console.log("Emitted JS/CSS gzip: PR " + candidateGzip + " bytes; main " +
    baselineGzip + " bytes; threshold " + max.toFixed(0) + " bytes");
  if (candidateGzip > max) failures.push("Gzip package footprint exceeds frozen baseline budget");
}
if (failures.length) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log("Targeted production benchmark correctness and regression budgets passed.");
}
