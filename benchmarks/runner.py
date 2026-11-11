#!/usr/bin/env python3
"""Production browser comparison, with strict semantic equivalence and raw sample evidence."""
import argparse
import json
import math
import os
import platform
import statistics
from datetime import datetime, timezone
from pathlib import Path

from playwright.sync_api import sync_playwright

CASES = ("counter", "rename", "reverse", "toggle")
VARIANTS = ("react", "baseline", "candidate")
READ_STATE = """() => ({
  count: Number(document.querySelector('#counter')?.textContent),
  length: document.querySelectorAll('#rows li').length,
  firstId: document.querySelector('#rows li span')?.textContent?.split('::')[0],
  renamed: [...document.querySelectorAll('#rows li span')].find(row => row.textContent?.startsWith('500::'))?.textContent,
  visible: Boolean(document.querySelector('#shown')),
  hidden: Boolean(document.querySelector('#hidden'))
})"""
RUN = """(operation) => {
  // Repeated odd-sized batches preserve an observable state change on every
  // sample while avoiding 0ms p50 from coarse WebKit/Firefox clocks.
  const repeat = {counter: 101, rename: 41, reverse: 1, toggle: 81}[operation];
  if (!repeat) throw new Error('Unknown benchmark operation');
  const before = performance.now();
  for (let i = 0; i < repeat; i++) window.__benchmark.run(operation);
  return (performance.now() - before) / repeat;
}"""


def assert_change(operation, before, after):
    assert after["length"] == 1000, f"{operation}: row count changed: {after}"
    assert after["count"] is not None and after["firstId"] is not None, "missing DOM"
    assert after["visible"] != after["hidden"], "visibility state invalid"
    for name in ("count", "firstId", "renamed", "visible"):
        expected_changed = name == {
            "counter": "count", "rename": "renamed",
            "reverse": "firstId", "toggle": "visible"
        }[operation]
        assert (after[name] != before[name]) == expected_changed, (
            f"{operation}: unexpected {name} transition: {before} -> {after}"
        )


def percentile(values, fraction):
    ordered = sorted(values)
    index = (len(ordered) - 1) * fraction
    lo, hi = math.floor(index), math.ceil(index)
    return ordered[lo] + (ordered[hi] - ordered[lo]) * (index - lo)


def measure(browser, url, warmup, samples):
    page = browser.new_page(viewport={"width": 1280, "height": 900}, device_scale_factor=1)
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    try:
        page.goto(url, wait_until="load", timeout=60000)
        page.wait_for_function("typeof window.__benchmark?.run === 'function'", timeout=30000)
        page.wait_for_function("document.querySelectorAll('#rows li').length === 1000", timeout=30000)
        initial = page.evaluate(READ_STATE)
        assert initial == {
            "count": 0, "length": 1000, "firstId": "0", "renamed": "500::Row 500",
            "visible": True, "hidden": False
        }, f"initial fixture mismatch: {initial}"
        mounted = page.evaluate("performance.getEntriesByName('bench-mounted').at(-1)?.startTime")
        assert isinstance(mounted, (int, float)) and mounted > 0, "missing startup performance mark"
        results = {}
        for operation in CASES:
            if operation == "reverse":
                page.evaluate("""() => {
                  window.__benchmarkIdentity = new Map(
                    [...document.querySelectorAll('#rows li')].map(node =>
                      [node.querySelector('span').textContent.split('::')[0], node])
                  );
                }""")
            timings = []
            for iteration in range(warmup + samples):
                before = page.evaluate(READ_STATE)
                elapsed = page.evaluate(RUN, operation)
                after = page.evaluate(READ_STATE)
                assert_change(operation, before, after)
                if operation == "reverse":
                    assert page.evaluate("""() => [...document.querySelectorAll('#rows li')].every(node =>
                      window.__benchmarkIdentity.get(node.querySelector('span').textContent.split('::')[0]) === node
                    )"""), "Keyed DOM element identity changed during reorder"
                assert isinstance(elapsed, (int, float)) and math.isfinite(elapsed) and elapsed >= 0
                if iteration >= warmup:
                    timings.append(elapsed)
            results[operation] = {
                "n": len(timings), "warmup": warmup, "p50_ms": percentile(timings, 0.5),
                "p95_ms": percentile(timings, 0.95), "mean_ms": statistics.mean(timings),
                "samples_ms": timings
            }
        heap = page.evaluate("""() => {
          const value = performance.memory?.usedJSHeapSize;
          return Number.isFinite(value) ? value : null;
        }""")
        assert not errors, f"Uncaught page exceptions: {errors}"
        return {"startup_mark_ms": mounted, "heap_bytes_uncontrolled": heap, "operations": results}
    finally:
        page.close()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--react", required=True)
    parser.add_argument("--baseline", required=True)
    parser.add_argument("--candidate", required=True)
    parser.add_argument("--samples", type=int, default=50)
    parser.add_argument("--warmup", type=int, default=10)
    parser.add_argument("--out", default="benchmark-artifacts/browser-results.json")
    args = parser.parse_args()
    if not (20 <= args.samples <= 500 and 0 <= args.warmup <= 100):
        parser.error("Require 20–500 measured iterations and 0–100 warmups")
    output = {
        "schemaVersion": 1,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "commit": os.environ.get("GITHUB_SHA", "local"),
        "baselineCommit": "f19b9f6a466de7f5b03dd085925c8d9092a87f85",
        "react": "19.2.4", "node": os.environ.get("NODE_VERSION", "record in workflow"),
        "host": {"os": platform.platform(), "machine": platform.machine()},
        "method": "Production Vite builds; 1000 keyed rows; synchronous run() including settled DOM, odd repeated update batches; isolated page per engine/framework",
        "repetitions_per_sample": {"counter": 101, "rename": 41, "reverse": 1, "toggle": 81},
        "samples": args.samples, "warmup": args.warmup,
        "browsers": {}
    }
    urls = {name: getattr(args, name) for name in VARIANTS}
    with sync_playwright() as playwright:
        for engine in ("chromium", "firefox", "webkit"):
            browser = getattr(playwright, engine).launch(headless=True)
            try:
                output["browsers"][engine] = {
                    "version": browser.version, "variants": {}
                }
                for name in VARIANTS:
                    metrics = measure(browser, urls[name], args.warmup, args.samples)
                    output["browsers"][engine]["variants"][name] = metrics
                    print(f"{engine:8} {name:9} " + " ".join(
                        f"{case}:p50={metrics['operations'][case]['p50_ms']:.3f}ms"
                        for case in CASES
                    ), flush=True)
            finally:
                browser.close()
    path = Path(args.out)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(output, indent=2) + "\n", encoding="utf-8")
    # Performance is environment-sensitive. New suites certify semantic parity and
    # publish exact samples; budget enforcement needs a reviewed, stable baseline.
    print(f"Wrote complete browser timing evidence to {path}")


if __name__ == "__main__":
    main()
