#!/usr/bin/env python3
"""Reproducible production browser comparison with semantic and DOM identity parity."""
import argparse
import json
import math
import os
import platform
import statistics
from datetime import datetime, timezone
from pathlib import Path

from playwright.sync_api import sync_playwright

CASES = ("counter", "rename", "reverse", "toggle", "swap", "rotate",
         "append", "prepend", "removeMiddle")
VARIANTS = ("react", "baseline", "candidate")

READ_STATE = """() => {
  const elements = [...document.querySelectorAll('#rows li')];
  const now = new Map();
  const ids = [];
  let renamed = null;
  for (const element of elements) {
    const value = element.querySelector('span')?.textContent;
    const match = /^(-?\d+)::(.*)$/.exec(value ?? '');
    if (!match) throw new Error('Malformed row: ' + value);
    const id = Number(match[1]);
    if (!Number.isSafeInteger(id) || now.has(id)) throw new Error('Invalid/duplicate row ' + id);
    if (match[2] !== 'Row ' + id && !(id === 500 && match[2] === 'Renamed 500')) {
      throw new Error('Unexpected row content ' + value);
    }
    if (id === 500) renamed = value;
    ids.push(id);
    now.set(id, element);
  }
  const previous = window.__benchNodes;
  let stable = true;
  if (previous) for (const [id, node] of previous) {
    if (now.has(id) && now.get(id) !== node) stable = false;
  }
  window.__benchNodes = now;
  return {
    count: Number(document.querySelector('#counter')?.textContent),
    ids, renamed, stable,
    visible: Boolean(document.querySelector('#shown')),
    hidden: Boolean(document.querySelector('#hidden'))
  };
}"""

RUN = """(operation) => {
  const repeat = {counter: 101, rename: 41, reverse: 1, toggle: 81,
                  swap: 1, rotate: 1, append: 1, prepend: 1, removeMiddle: 1}[operation];
  if (!repeat) throw new Error('Unknown benchmark operation');
  const before = performance.now();
  for (let i = 0; i < repeat; i++) window.__benchmark.run(operation);
  return (performance.now() - before) / repeat;
}"""


def assert_change(operation, before, after):
    assert after["stable"], f"{operation}: retained DOM element identity changed"
    assert after["visible"] != after["hidden"], f"{operation}: visibility mismatch"
    assert len(after["ids"]) == len(set(after["ids"])), f"{operation}: duplicate row keys"
    assert math.isfinite(after["count"]), f"{operation}: invalid counter"
    expected_count = before["count"] + (101 if operation == "counter" else 0)
    assert after["count"] == expected_count, f"{operation}: unexpected counter change"
    assert after["visible"] == (not before["visible"] if operation == "toggle" else before["visible"]), (
        f"{operation}: visibility changed incorrectly"
    )
    if operation == "rename":
        expected_renamed = ("500::Renamed 500" if before["renamed"] == "500::Row 500"
                            else "500::Row 500")
    elif operation == "removeMiddle":
        expected_renamed = "500::Row 500" if before["renamed"] is None else None
    else:
        expected_renamed = before["renamed"]
    assert after["renamed"] == expected_renamed, f"{operation}: unexpected item data"
    a, b = before["ids"], after["ids"]
    expected = {
        "reverse": lambda: a[::-1],
        "swap": lambda: [a[-1], *a[1:-1], a[0]],
        "rotate": lambda: [a[-1], *a[:-1]],
        "append": lambda: [id for id in a if id != 1000] if 1000 in a else [*a, 1000],
        "prepend": lambda: [id for id in a if id != -1] if -1 in a else [-1, *a],
        "removeMiddle": lambda: [id for id in a if id != 500] if 500 in a else [*a, 500],
    }.get(operation, lambda: a)()
    assert b == expected, f"{operation}: incorrect keyed list change (first 12 {b[:12]} vs {expected[:12]})"


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
            "count": 0, "ids": list(range(1000)), "renamed": "500::Row 500",
            "stable": True, "visible": True, "hidden": False
        }, "Initial benchmark fixture is not semantically equivalent"
        mounted = page.evaluate("performance.getEntriesByName('bench-mounted').at(-1)?.startTime")
        assert isinstance(mounted, (int, float)) and math.isfinite(mounted) and mounted > 0
        results = {}
        for operation in CASES:
            timings = []
            for iteration in range(warmup + samples):
                before = page.evaluate(READ_STATE)
                elapsed = page.evaluate(RUN, operation)
                after = page.evaluate(READ_STATE)
                assert_change(operation, before, after)
                assert isinstance(elapsed, (int, float)) and math.isfinite(elapsed) and elapsed >= 0
                if iteration >= warmup:
                    timings.append(elapsed)
            results[operation] = {
                "n": len(timings), "warmup": warmup, "p50_ms": percentile(timings, 0.5),
                "p95_ms": percentile(timings, 0.95), "p99_ms": percentile(timings, 0.99),
                "mean_ms": statistics.mean(timings),
                "stddev_ms": statistics.stdev(timings) if len(timings) > 1 else 0,
                "min_ms": min(timings), "max_ms": max(timings),
                "samples_ms": timings
            }
        heap = page.evaluate("""() => {
          const value = performance.memory?.usedJSHeapSize;
          return Number.isFinite(value) ? value : null;
        }""")
        assert not errors, f"Uncaught page exceptions: {errors}"
        return {"startup_mark_ms": mounted, "heap_bytes_uncontrolled": heap,
                "operations": results}
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
        parser.error("Require 20–500 samples and 0–100 warmups")
    output = {
        "schemaVersion": 2,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "commit": os.environ.get("GITHUB_SHA", "local"),
        "baselineCommit": "f19b9f6a466de7f5b03dd085925c8d9092a87f85",
        "react": "19.2.4",
        "host": {"os": platform.platform(), "machine": platform.machine()},
        "method": "Production Vite; 1000 keyed rows; state parity and retained node identity on every sample",
        "repetitions_per_sample": {
            "counter": 101, "rename": 41, "reverse": 1, "toggle": 81,
            "swap": 1, "rotate": 1, "append": 1, "prepend": 1, "removeMiddle": 1
        },
        "samples": args.samples, "warmup": args.warmup, "browsers": {}
    }
    urls = {name: getattr(args, name) for name in VARIANTS}
    with sync_playwright() as playwright:
        for engine in ("chromium", "firefox", "webkit"):
            browser = getattr(playwright, engine).launch(headless=True)
            try:
                output["browsers"][engine] = {"version": browser.version, "variants": {}}
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
    print(f"Wrote benchmark evidence to {path}")


if __name__ == "__main__":
    main()
