import {readFileSync} from "node:fs";

const data = JSON.parse(readFileSync("benchmark-artifacts/browser-results.json", "utf8"));
const bundles = JSON.parse(readFileSync("benchmark-artifacts/bundle-sizes.json", "utf8"));
const failures = [];
const operations = ["counter", "rename", "reverse", "toggle", "swap", "rotate",
  "append", "prepend", "removeMiddle"];
const sparseOperations = ["swap", "rotate", "append", "prepend", "removeMiddle"];
for (const name of ["chromium", "firefox", "webkit"]) {
  const variants = data.browsers[name]?.variants;
  if (!variants) { failures.push("No browser evidence: " + name); continue; }
  let valid = true;
  for (const operation of operations) {
    const values = ["react", "baseline", "hardening", "candidate"]
      .map(framework => variants[framework]?.operations?.[operation]);
    if (values.some(value => !value || value.n !== data.samples ||
        !Number.isFinite(value.p50_ms) || !Number.isFinite(value.p95_ms) ||
        !Number.isFinite(value.p99_ms) || !Array.isArray(value.samples_ms) ||
        value.samples_ms.length !== data.samples || value.samples_ms.some(sample =>
          !Number.isFinite(sample) || sample < 0) ||
        value.p50_ms < 0 || value.p95_ms < value.p50_ms ||
        value.p99_ms < value.p95_ms)) {
      failures.push("Missing/invalid " + operation + " p50/p95/p99 and samples for " + name);
      valid = false;
    }
  }
  if (!valid) continue;
  const [react, baseline, hardening, candidate] =
    ["react", "baseline", "hardening", "candidate"]
      .map(framework => variants[framework].operations.reverse);
  for (const operation of sparseOperations) {
    const before = variants.hardening.operations[operation];
    const after = variants.candidate.operations[operation];
    // Large sparse reorder regressions are real, but a 1ms floor is needed
    // for coarse-timer browsers and non-dedicated CI hosts.
    const ceiling = before.p95_ms * 1.5 + 2;
    if (after.p95_ms > ceiling) {
      failures.push(name + " " + operation + " p95 regression vs frozen hardening (" +
        after.p95_ms.toFixed(3) + " > " + ceiling.toFixed(3) + "ms)");
    }
  }
  // Calibrated against the frozen-main/React reference on the same runner.
  // Slack is intentional: GitHub-hosted runners and browser timers are noisy.
  const reactLimit = react.p95_ms * 2 + 10;
  const baselineLimit = baseline.p95_ms * 1.5 + 10;
  const hardeningLimit = hardening.p95_ms * 1.25 + 2;
  const limit = Math.min(reactLimit, baselineLimit, hardeningLimit);
  console.log(name + " reverse p95: PR " + candidate.p95_ms.toFixed(3) +
    "ms; React " + react.p95_ms.toFixed(3) + "ms; main " +
    baseline.p95_ms.toFixed(3) + "ms; hardening " + hardening.p95_ms.toFixed(3) +
    "ms; threshold " + limit.toFixed(3) + "ms");
  if (candidate.p95_ms > limit) {
    failures.push(name + " keyed reorder p95 exceeds reviewed reference/main threshold");
  }
}
const baselineGzip = bundles.assets.baseline?.totals?.gzip;
const candidateGzip = bundles.assets.candidate?.totals?.gzip;
const hardeningGzip = bundles.assets.hardening?.totals?.gzip;
if (!Number.isFinite(baselineGzip) || !Number.isFinite(candidateGzip) || !Number.isFinite(hardeningGzip) ||
    baselineGzip <= 0 || candidateGzip <= 0) {
  failures.push("Missing production JS/CSS gzip evidence");
} else {
  const max = Math.min(baselineGzip * 1.1 + 512, hardeningGzip * 1.05 + 512);
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