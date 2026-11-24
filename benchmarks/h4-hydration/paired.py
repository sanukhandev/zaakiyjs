#!/usr/bin/env python3
"""Compare pinned main, PR99 and candidate builds on the same browser worker.

The normal H4 four-framework certificate remains separate. Reuse its full
interaction/adoption/disposal assertions. Two alternating blocks of 25 measured
samples give 50 samples per variant/size; no results from different hosts are pooled.
"""
import argparse
import json
import math
import platform
from pathlib import Path
from measure import run, percentile

LABELS = ("main", "pr99", "candidate")
SIZES = (1000, 10000)
ORDERS = (LABELS, tuple(reversed(LABELS)))

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--site-root", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--engine", choices=("chromium", "firefox", "webkit"), required=True)
    parser.add_argument("--candidate", required=True)
    args = parser.parse_args()
    expected = {
        "main": "b0da54d2bdfb9c984cf0409755fafc98b940f183",
        "pr99": "afb71fd8e9f175271e832fac34c776c2570c51ed",
        "candidate": args.candidate,
    }
    args.output.mkdir(parents=True, exist_ok=True)
    variants = {}
    for label in LABELS:
        manifest = json.loads((args.site_root / label / "build-manifest.json").read_text())
        if manifest.get("schema") != "zaakiy.h4-paired-build/1" or manifest.get("commit") != expected[label]:
            raise AssertionError(f"Unexpected build identity for {label}: {manifest}")
        variants[label] = manifest
    if len({v["node"] for v in variants.values()}) != 1:
        raise AssertionError("Inconsistent build Node runtime")
    measurements = {(label, size): [] for label in LABELS for size in SIZES}
    versions = set()
    for block, order in enumerate(ORDERS):
        for label in order:
            output = args.output / f"{label}-block-{block}.json"
            run(argparse.Namespace(
                site=args.site_root / label, output=output,
                head=expected[label], frameworks="zaakiyjs", engines=args.engine,
                sizes=",".join(map(str, SIZES)), samples=25, warmups=5,
                timeout_ms=60000,
            ))
            report = json.loads(output.read_text())
            if report["head"] != expected[label] or len(report["cases"]) != len(SIZES):
                raise AssertionError("Missing or mismatched paired evidence")
            for case in report["cases"]:
                size = case["size"]
                versions.add(case["browserVersion"])
                raw = case["hydrationMs"]["raw"]
                if case["framework"] != "zaakiyjs" or case["browser"] != args.engine or size not in SIZES:
                    raise AssertionError("Unexpected paired test case")
                if case["correctness"] != "passed" or len(raw) != 25 or any(
                    not math.isfinite(x) or x < 0 for x in raw
                ):
                    raise AssertionError("Invalid paired correctness or timings")
                if case["hydrationMutations"] != [0] * 25:
                    raise AssertionError("Unexpected hydration mutations")
                measurements[label, size].extend(raw)
    if len(versions) != 1 or any(len(v) != 50 for v in measurements.values()):
        raise AssertionError("Incomplete or inconsistent paired measurements")
    cases = []
    for size in SIZES:
        metrics = {}
        for label in LABELS:
            raw = measurements[label, size]
            metrics[label] = {
                "p50": percentile(raw, .50), "p95": percentile(raw, .95),
                "p99": percentile(raw, .99), "raw": raw,
            }
        for before, after in (("main", "pr99"), ("pr99", "candidate"), ("main", "candidate")):
            if metrics[before]["p95"] <= 0:
                raise AssertionError("Invalid p95 denominator")
            change = (metrics[after]["p95"] / metrics[before]["p95"] - 1) * 100
            cases.append({
                "size": size, "baseline": before, "candidate": after,
                "baselineP95Ms": metrics[before]["p95"], "candidateP95Ms": metrics[after]["p95"],
                "p95ChangePercent": change, "investigate": change > 5,
                "baselineMetrics": metrics[before], "candidateMetrics": metrics[after],
            })
    result = {
        "schema": "zaakiy.h4-paired-evidence/1", "system": platform.platform(),
        "engine": args.engine, "browserVersion": versions.pop(),
        "orders": ORDERS, "samplesPerCase": 50, "warmupsPerBlock": 5,
        "builds": variants, "comparisons": cases,
        "interpretation": "Single-runner alternating blocks; repeat independently before a performance merge decision. A >5% p95 increase is an investigation flag, not automatic proof of a regression.",
    }
    (args.output / "paired-summary.json").write_text(json.dumps(result, indent=2) + "\n")
    for case in cases:
        print(f"{args.engine} {case['size']} {case['baseline']} -> {case['candidate']}: "
              f"{case['baselineP95Ms']:.2f} -> {case['candidateP95Ms']:.2f} ms "
              f"({case['p95ChangePercent']:+.1f}%)")

if __name__ == "__main__":
    main()
