#!/usr/bin/env python3
"""Validate independent same-worker trials without pooling cross-host samples."""
import argparse
import json
import math
import statistics
from pathlib import Path

ENGINES = ("chromium", "firefox", "webkit")
SIZES = (1000, 10000)
PAIRS = (("main", "pr99"), ("pr99", "candidate"), ("main", "candidate"))

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--head", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    trials = {}
    builds = None
    for file in args.source.rglob("paired-summary.json"):
        report = json.loads(file.read_text())
        engine = report["engine"]
        if engine not in ENGINES or report["schema"] != "zaakiy.h4-paired-evidence/1" or report["samplesPerCase"] != 50:
            raise AssertionError(f"Invalid evidence: {file}")
        if report["builds"]["candidate"]["commit"] != args.head:
            raise AssertionError("Candidate SHA mismatch")
        if builds is None:
            builds = report["builds"]
        elif builds != report["builds"]:
            raise AssertionError("Build manifests differ between independent trials")
        comparisons = {}
        for case in report["comparisons"]:
            key = (case["size"], case["baseline"], case["candidate"])
            if key in comparisons or key not in [(size, *pair) for size in SIZES for pair in PAIRS]:
                raise AssertionError("Duplicate or unknown comparison")
            for metric in ("baselineMetrics", "candidateMetrics"):
                raw = case[metric]["raw"]
                if len(raw) != 50 or any(not math.isfinite(x) or x < 0 for x in raw):
                    raise AssertionError("Invalid raw evidence")
            comparisons[key] = case["p95ChangePercent"]
        if len(comparisons) != len(SIZES) * len(PAIRS):
            raise AssertionError("Missing comparisons")
        trials.setdefault(engine, []).append((file.parent.name, report["browserVersion"], comparisons))
    if set(trials) != set(ENGINES) or any(len(group) != 3 for group in trials.values()):
        raise AssertionError("Require exactly three independent trials per browser")
    summary = []
    for engine, group in trials.items():
        if len({name for name, _, _ in group}) != 3 or len({version for _, version, _ in group}) != 1:
            raise AssertionError("Duplicate trial identity or browser version mismatch")
        for size in SIZES:
            for before, after in PAIRS:
                changes = [values[(size, before, after)] for _, _, values in group]
                summary.append({"browser": engine, "size": size, "baseline": before,
                                "candidate": after, "trialP95ChangePercent": changes,
                                "medianP95ChangePercent": statistics.median(changes),
                                "persistentRegression": all(v > 5 for v in changes)})
    report = {"schema": "zaakiy.h4-paired-review/1", "head": args.head,
              "trialsPerBrowser": 3, "samplesPerVariantSizeTrial": 50,
              "comparisons": summary,
              "interpretation": "Persistent >5% p95 regressions require investigation and block merge review until resolved. This evidence validation does not approve a performance trade-off."}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))

if __name__ == "__main__":
    main()
