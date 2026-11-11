import {test} from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync, mkdirSync, writeFileSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import {spawnSync} from "node:child_process";

const gate = resolve("benchmarks/regression-gate.mjs");
const ops = ["counter", "rename", "reverse", "toggle", "swap", "rotate",
  "append", "prepend", "removeMiddle"];

function fixture() {
  const result = (p95) => ({
    n: 20, p50_ms: p95 * 0.8, p95_ms: p95, p99_ms: p95,
    samples_ms: Array.from({length: 20}, () => p95)
  });
  return {
    data: {
      samples: 20,
      browsers: Object.fromEntries(["chromium", "firefox", "webkit"].map(browser => [
        browser, {
          variants: Object.fromEntries(["react", "baseline", "hardening", "candidate"]
            .map(name => [name, {
              operations: Object.fromEntries(ops.map(op => [op,
                result(name === "react" ? 6 : name === "baseline" ? 7 : 5)]))
            }]))
        }
      ]))
    },
    bundle: {assets: Object.fromEntries(["react", "baseline", "hardening", "candidate"]
      .map(name => [name, {totals: {gzip: 1000}}]))}
  };
}
function execute(change) {
  const dir = mkdtempSync(join(tmpdir(), "zaakiy-perf-gate-"));
  try {
    const {data, bundle} = fixture();
    change?.(data, bundle);
    mkdirSync(join(dir, "benchmark-artifacts"));
    writeFileSync(join(dir, "benchmark-artifacts/browser-results.json"), JSON.stringify(data));
    writeFileSync(join(dir, "benchmark-artifacts/bundle-sizes.json"), JSON.stringify(bundle));
    return spawnSync(process.execPath, [gate], {cwd: dir, encoding: "utf8"});
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
}
test("accepts complete, valid samples and all four comparators", () => {
  const result = execute();
  assert.equal(result.status, 0, result.stderr + result.stdout);
});
test("rejects a measurable reverse p95 regression", () => {
  const result = execute(data => {
    const r = data.browsers.firefox.variants.candidate.operations.reverse;
    r.p95_ms = 20;
    r.p99_ms = 20;
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /keyed reorder p95 exceeds/);
});
test("rejects a measurable sparse prepend regression", () => {
  const result = execute(data => {
    const r = data.browsers.webkit.variants.candidate.operations.prepend;
    r.p95_ms = 20;
    r.p99_ms = 20;
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /prepend p95 regression/);
});
test("rejects missing browser evidence", () => {
  const result = execute(data => {delete data.browsers.webkit;});
  assert.equal(result.status, 1);
  assert.match(result.stderr, /No browser evidence/);
});
test("rejects absent operation evidence even when reversal exists", () => {
  const result = execute(data => {
    delete data.browsers.firefox.variants.candidate.operations.swap;
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Missing\/invalid swap/);
});
test("rejects malformed sample counts", () => {
  const result = execute(data => {
    data.browsers.chromium.variants.candidate.operations.reverse.n = 19;
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Missing\/invalid reverse/);
});
test("rejects nonfinite raw samples", () => {
  const result = execute(data => {
    data.browsers.chromium.variants.candidate.operations.rename.samples_ms[0] = -1;
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Missing\/invalid rename/);
});
test("rejects excess emitted bundle growth", () => {
  const result = execute((_data, bundle) => {
    bundle.assets.candidate.totals.gzip = 2000;
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Gzip package footprint exceeds/);
});
