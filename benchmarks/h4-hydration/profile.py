#!/usr/bin/env python3
"""Diagnostic profile only: no instrumented timings are used as release latency."""
import argparse
import functools
import json
import math
import platform
import threading
from http.server import ThreadingHTTPServer
from pathlib import Path
from playwright.sync_api import sync_playwright
from measure import Handler, percentile

PHASES = (
    "protocol", "structural-inspection", "binding-discovery", "event-validation",
    "attachment-setup", "root-owner", "attachment", "mount-activation", "total",
)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--site", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--head", required=True)
    parser.add_argument("--engine", choices=("chromium", "firefox", "webkit"), required=True)
    args = parser.parse_args()
    server = ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Handler, directory=str(args.site.resolve())))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    report = {"schema": "zaakiy.h4-phase-profile/1", "head": args.head,
              "engine": args.engine, "system": platform.platform(), "diagnosticOnly": True,
              "samplesPerCase": 10, "warmups": 2, "cases": []}
    try:
        with sync_playwright() as pw:
            browser = getattr(pw, args.engine).launch(headless=True)
            try:
                report["browserVersion"] = browser.version
                for size in (100, 1000, 10000):
                    samples = []
                    for iteration in range(12):
                        page = browser.new_page(viewport={"width": 1280, "height": 900})
                        errors = []
                        page.on("pageerror", lambda error: errors.append(str(error)))
                        try:
                            page.goto(f"http://127.0.0.1:{server.server_port}/zaakiyjs/{size}/", wait_until="load")
                            page.wait_for_function("window.__h4 && window.__h4.ready===true", timeout=60000)
                            data = page.evaluate("""() => ({
                              ready:window.__h4.ready, error:window.__h4.error,
                              adopted:window.__h4.adopted, focus:window.__h4.preservedFocus,
                              draft:window.__h4.preservedDraft, mutations:window.__h4.mutations,
                              rows:window.__h4.liveRows,
                              measures:performance.getEntriesByType('measure').filter(e=>e.name.startsWith('h4/')).map(e=>({name:e.name.slice(3),ms:e.duration})),
                              structural:performance.getEntriesByName('h4/structural-counters').at(-1)?.detail,
                              attachment:performance.getEntriesByName('h4/attachment-counters').at(-1)?.detail
                            })""")
                            if errors or data.get("error") or not all(data.get(k) is True for k in ("ready", "adopted", "focus", "draft")) or data["rows"] != size or data["mutations"] != 0:
                                raise AssertionError(f"Profile build correctness failed: {errors} {data}")
                            measures = {m["name"]: m["ms"] for m in data["measures"]}
                            if len(data["measures"]) != len(PHASES) or set(measures) != set(PHASES) or any(not math.isfinite(v) or v < 0 for v in measures.values()):
                                raise AssertionError(f"Incomplete profile: {measures}")
                            if (data["attachment"]["adoptedRows"] != size or data["attachment"]["itemSlots"] != size
                                    or data["attachment"]["snapshotTextBindings"] != size
                                    or data["attachment"]["flatRows"] != size
                                    or data["attachment"]["rowOwners"] != 0
                                    or data["attachment"]["trackedTextBindings"] + size != data["attachment"]["slots"]
                                    or data["structural"]["visitedPlanNodes"] < size):
                                raise AssertionError(f"Invalid counters: {data}")
                            page.evaluate("() => {window.__h4.dispose();if(!window.__h4.verifyDisposed())throw Error('Profile disposal failed');}")
                            if iteration >= 2:
                                samples.append({"ms": measures, "structural": data["structural"], "attachment": data["attachment"]})
                        finally:
                            page.close()
                    report["cases"].append({"size": size, "raw": samples, "phases": {
                        phase: {p: percentile([s["ms"][phase] for s in samples], q) for p, q in (("p50", .5), ("p95", .95))}
                        for phase in PHASES}})
            finally:
                browser.close()
    finally:
        server.shutdown()
        server.server_close()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report))

if __name__ == "__main__":
    main()
