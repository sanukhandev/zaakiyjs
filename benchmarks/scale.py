#!/usr/bin/env python3
"""Production-built large-list scaling and disposal correctness, not a universal ranking."""
import argparse
import json
import math
import platform
import statistics
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlencode
from playwright.sync_api import sync_playwright

OPS = ("reverse", "rotate")
VARIANTS = ("react", "hardening", "candidate")


def percentile(values, fraction):
    ordered = sorted(values)
    position = (len(ordered) - 1) * fraction
    lo, hi = math.floor(position), math.ceil(position)
    return ordered[lo] + (ordered[hi] - ordered[lo]) * (position - lo)


SCRIPT = r"""(op) => {
  const current = [...document.querySelectorAll('#rows li')];
  const id = node => {
    const label = node.querySelector('span')?.textContent ?? '';
    const parts = /^(-?\d+)::Row -?\d+$/.exec(label);
    if (!parts) throw new Error('Invalid row label ' + label);
    return Number(parts[1]);
  };
  const currentIds = current.map(id);
  if (new Set(currentIds).size !== current.length) throw new Error('Duplicate input keys');
  const originalNodes = new Map(currentIds.map((key, i) => [key, current[i]]));
  const started = performance.now();
  window.__benchmark.run(op);
  const elapsed = performance.now() - started;
  const expected = op === 'reverse' ? currentIds.slice().reverse() :
    [currentIds.at(-1), ...currentIds.slice(0, -1)];
  const after = [...document.querySelectorAll('#rows li')];
  if (after.length !== expected.length) throw new Error('List length incorrect');
  for (let i = 0; i < expected.length; i++) {
    if (id(after[i]) !== expected[i] || originalNodes.get(expected[i]) !== after[i]) {
      throw new Error('Keyed order/identity mismatch for ' + op + ' at ' + i);
    }
  }
  if (!(Number.isFinite(elapsed) && elapsed >= 0)) throw new Error('Bad timing');
  return elapsed;
}"""


def measure(browser, url, n, samples, warmups):
    address = url + ("&" if "?" in url else "?") + urlencode({"rows": n})
    page = browser.new_page(viewport={"width": 1280, "height": 900}, device_scale_factor=1)
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    try:
        page.goto(address, wait_until="load", timeout=60000)
        page.wait_for_function("typeof window.__benchmark?.run === 'function'", timeout=30000)
        page.wait_for_function("(n) => document.querySelectorAll('#rows li').length === n",
                               arg=n, timeout=60000)
        observed = page.locator("#rows li").count()
        if observed != n:
            raise AssertionError("Wrong initial row count: " + str(observed))
        timings = {}
        for op in OPS:
            times = []
            for j in range(warmups + samples):
                value = page.evaluate(SCRIPT, op)
                if j >= warmups:
                    times.append(value)
            timings[op] = {
                "n": len(times), "p50_ms": percentile(times, 0.5),
                "p95_ms": percentile(times, 0.95), "samples_ms": times
            }
        page.evaluate("() => window.__benchmark.dispose()")
        page.wait_for_function("document.querySelectorAll('#rows li').length === 0",
                               timeout=15000)
        retained_rows = page.locator("#rows li").count()
        if retained_rows != 0:
            raise AssertionError("Owner/root did not dispose DOM")
        heap = page.evaluate("""() => {
          const n = performance.memory?.usedJSHeapSize;
          return Number.isFinite(n) ? n : null;
        }""")
        if errors:
            raise AssertionError("Uncaught browser exceptions: " + repr(errors))
        return {"operations": timings, "disposal": {"rowsAfter": retained_rows},
                "heapAfterDisposeUncontrolled": heap}
    finally:
        page.close()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--react", required=True)
    ap.add_argument("--hardening", required=True)
    ap.add_argument("--candidate", required=True)
    ap.add_argument("--sizes", default="100,1000,5000")
    ap.add_argument("--samples", type=int, default=7)
    ap.add_argument("--warmups", type=int, default=2)
    ap.add_argument("--out", default="benchmark-artifacts/scale-results.json")
    args = ap.parse_args()
    sizes = [int(item.strip()) for item in args.sizes.split(",")]
    if not sizes or len(sizes) != len(set(sizes)) or any(n < 1 or n > 10000 for n in sizes):
        ap.error("Sizes must be unique positive integers <= 10000")
    if not 3 <= args.samples <= 100 or not 0 <= args.warmups <= 20:
        ap.error("Invalid samples or warmups")
    output = {
        "schemaVersion": 1, "timestamp": datetime.now(timezone.utc).isoformat(),
        "host": {"os": platform.platform(), "machine": platform.machine()},
        "variants": VARIANTS, "sizes": sizes,
        "samples": args.samples, "warmups": args.warmups,
        "method": "Production Vite; synchronous keyed reverse/rotate; exact order, native identity and root disposal asserted",
        "browsers": {}
    }
    urls = {v: getattr(args, v) for v in VARIANTS}
    with sync_playwright() as p:
        for engine in ("chromium", "firefox", "webkit"):
            browser = getattr(p, engine).launch(headless=True)
            try:
                results = {"version": browser.version, "variants": {}}
                for variant in VARIANTS:
                    results["variants"][variant] = {}
                    for n in sizes:
                        data = measure(browser, urls[variant], n, args.samples, args.warmups)
                        results["variants"][variant][str(n)] = data
                        print(engine, variant, n, " ".join(
                            f"{k}:p50={v['p50_ms']:.3f}ms" for k, v in data["operations"].items()),
                            flush=True)
                output["browsers"][engine] = results
            finally:
                browser.close()
    path = Path(args.out)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(output, indent=2) + "\n", encoding="utf-8")
    print("Wrote valid scale and teardown evidence:", path)


if __name__ == "__main__":
    main()
