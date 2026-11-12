#!/usr/bin/env python3
"""H6: real browser verification of compiler-authored native data hydration."""
import argparse
import functools
import json
import math
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from playwright.sync_api import sync_playwright


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, format, *args):
        pass


def run(dist: Path, output: Path):
    handler = functools.partial(QuietHandler, directory=str(dist))
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    url = f"http://127.0.0.1:{server.server_port}/index.html"
    report = {"schemaVersion": 1, "fixture": "compiled-data-hydration-v1", "browsers": []}
    try:
        with sync_playwright() as playwright:
            for name in ("chromium", "firefox", "webkit"):
                browser = getattr(playwright, name).launch(headless=True)
                try:
                    page = browser.new_page(viewport={"width": 1200, "height": 800})
                    errors = []
                    page.on("pageerror", lambda error: errors.append(str(error)))
                    page.goto(url, wait_until="load", timeout=60000)
                    page.wait_for_function(
                        "window.__zaakiyHydration && window.__zaakiyHydration.ready",
                        timeout=20000
                    )
                    before = page.evaluate("""() => {
                      const r=window.__zaakiyHydration;
                      return {
                        error:r.error, adoptionMs:r.adoptionMs,
                        p50Ms:r.p50Ms, p95Ms:r.p95Ms, samples:r.samples,
                        iterationsPerSample:r.iterationsPerSample, warmups:r.warmups,
                        mutations:r.mutations, identity:r.identity,
                        preservedFocus:r.preservedFocus,
                        preservedSelection:r.preservedSelection,
                        preservedDraft:r.preservedDraft, stableText:r.stableText
                      };
                    }""")
                    if errors or before.get("error"):
                        raise AssertionError(f"{name}: hydration failed: {errors}, {before.get('error')}")
                    for key in ("identity", "preservedFocus", "preservedSelection",
                                "preservedDraft", "stableText"):
                        if before.get(key) is not True:
                            raise AssertionError(f"{name}: {key} was not preserved")
                    if before.get("mutations") != 0:
                        raise AssertionError(f"{name}: matching markup mutated during hydration")
                    if (len(before["samples"]) != 20 or before["iterationsPerSample"] != 1000 or
                        before["warmups"] != 2 or not all(
                        math.isfinite(x) and x >= 0 for x in before["samples"]
                    ) or max(before["samples"]) <= 0):
                        raise AssertionError(f"{name}: invalid timing evidence")
                    page.locator("button").click()
                    after = page.evaluate("""() => {
                      const r=window.__zaakiyHydration;
                      return {clicks:r.clicks, text:r.buttonText,
                        textIdentity:r.textIdentity,
                        input:document.querySelector("input").value};
                    }""")
                    if after != {
                        "clicks": 1, "text": "Count: 1", "textIdentity": True,
                        "input": "visitor draft"
                    }:
                        raise AssertionError(f"{name}: reactive interaction mismatch: {after}")
                    page.evaluate("window.__zaakiyHydration.dispose()")
                    page.locator("button").click()
                    disposed = page.evaluate("""() => ({
                      clicks:window.__zaakiyHydration.clicks,
                      text:window.__zaakiyHydration.buttonText
                    })""")
                    if disposed != {"clicks": 1, "text": "Count: 1"}:
                        raise AssertionError(f"{name}: listener survived disposal: {disposed}")
                    # H4 compiler-generated component/keyed/conditional hydration,
                    # using an independently generated production Vite bundle.
                    h4 = browser.new_page(viewport={"width": 1200, "height": 800})
                    h4_errors = []
                    h4.on("pageerror", lambda error: h4_errors.append(str(error)))
                    try:
                        h4.goto(
                            f"http://127.0.0.1:{server.server_port}/h4.html",
                            wait_until="load", timeout=60000
                        )
                        h4.wait_for_function(
                            "window.__zaakiyH4 && window.__zaakiyH4.ready",
                            timeout=20000
                        )
                        h4_result = h4.evaluate("window.__zaakiyH4")
                        if h4_errors or h4_result.get("error"):
                            raise AssertionError(
                                f"{name}: H4 failed: {h4_errors}, {h4_result.get('error')}"
                            )
                        for key in ("identity", "focus", "moved", "switched",
                                    "updated", "focusAfter", "reused", "addition",
                                    "changed", "returned", "preserved"):
                            if h4_result.get(key) is not True:
                                raise AssertionError(
                                    f"{name}: H4 {key} failed: {h4_result}"
                                )
                        if h4_result.get("mutations") != 0 or h4_result.get("lastState") != 2:
                            raise AssertionError(
                                f"{name}: H4 matching hydration mutated DOM: {h4_result}"
                            )
                    finally:
                        h4.close()
                    report["browsers"].append({
                        "engine": name, "adoptionMs": before["adoptionMs"],
                        "p50Ms": before["p50Ms"], "p95Ms": before["p95Ms"],
                        "samplesMs": before["samples"], "iterationsPerSample": 1000,
                        "warmups": 2, "mutations": 0,
                        "existingNodesPreserved": True, "listenerCleanup": True,
                        "h4RegionHydration": True
                    })
                    page.close()
                finally:
                    browser.close()
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps([{
        "browser": row["engine"], "p50Ms": row["p50Ms"],
        "p95Ms": row["p95Ms"], "mutations": row["mutations"]
    } for row in report["browsers"]], indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--dist", default="benchmark-artifacts/hydration-browser")
    parser.add_argument("--output", default="benchmark-artifacts/hydration-browser-evidence.json")
    args = parser.parse_args()
    run(Path(args.dist).resolve(), Path(args.output).resolve())
