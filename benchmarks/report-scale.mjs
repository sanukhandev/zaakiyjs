import {readFile, writeFile} from "node:fs/promises";
const evidence = JSON.parse(await readFile("benchmark-artifacts/scale-results.json", "utf8"));
const lines = [
  "# Production large-list scaling",
  "",
  "Same application semantics; production Vite builds; node identity and complete root DOM removal asserted on every tested size.",
  "Latency is milliseconds per synchronous state update. Values are diagnostic, not Core Web Vitals or memory-leak certification.",
  "",
  "| Browser | Rows | React reverse p50 | Hardening reverse p50 | Candidate reverse p50 | Candidate rotate p50 | Candidate reverse p95 |",
  "| --- | ---: | ---: | ---: | ---: | ---: | ---: |"
];
for (const engine of ["chromium", "firefox", "webkit"]) {
  const browser = evidence.browsers[engine];
  if (!browser) throw new Error("Missing scale evidence: " + engine);
  for (const n of evidence.sizes) {
    const key = String(n);
    const a = browser.variants.react?.[key];
    const b = browser.variants.hardening?.[key];
    const c = browser.variants.candidate?.[key];
    if (!a || !b || !c || a.disposal.rowsAfter !== 0 ||
        b.disposal.rowsAfter !== 0 || c.disposal.rowsAfter !== 0) {
      throw new Error("Incomplete scale or disposal data: " + engine + " rows " + n);
    }
    const reverse = x => x.operations.reverse;
    if ([a, b, c].some(x => reverse(x).n !== evidence.samples ||
        !Number.isFinite(reverse(x).p95_ms) || !Number.isFinite(x.operations.rotate.p50_ms))) {
      throw new Error("Missing or invalid scale samples: " + engine + " rows " + n);
    }
    lines.push("| " + engine + " | " + n + " | " +
      reverse(a).p50_ms.toFixed(2) + " | " + reverse(b).p50_ms.toFixed(2) +
      " | " + reverse(c).p50_ms.toFixed(2) + " | " +
      c.operations.rotate.p50_ms.toFixed(2) + " | " +
      reverse(c).p95_ms.toFixed(2) + " |");
  }
}
lines.push("", "Heap readings, where available, are uncontrolled single observations after DOM disposal; they are not a retained-memory or leak-freedom claim.",
  "The frozen original main comparison is excluded at scale because its WebKit O(n²) reorder path can cause unbounded test runtime.",
  "");
await writeFile("benchmark-artifacts/scale-summary.md", lines.join("\n"));
console.log(lines.join("\n"));
