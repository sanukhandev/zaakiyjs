#!/usr/bin/env python3
"""H4 matched SSR hydration harness. A missing/invalid comparator is a failed run.

Each production-built variant serves /<framework>/<size>/index.html and exposes
window.__h4 = {ready,hydrationMs,adopted,mutations,preservedDraft,preservedFocus,
                 update(),reverse(),dispose(),verify(),keyIdentity,liveRows}.
The page records these values in its own client hydration callback, not with
Playwright roundtrip timing. This program never substitutes client mount for SSR.
"""
import argparse
import functools
import json
import math
import platform
import statistics
import threading
from datetime import datetime, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from playwright.sync_api import sync_playwright

FRAMEWORKS = ("zaakiyjs", "react", "vue", "angular")
SCALES = (100, 1000, 10000)
ENGINES = ("chromium", "firefox", "webkit")

class Handler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass

def percentile(values, fraction):
    values = sorted(values)
    point = (len(values)-1)*fraction
    low = math.floor(point)
    high = math.ceil(point)
    return values[low]+(values[high]-values[low])*(point-low)

def run(args):
    root = args.site.resolve()
    if not root.is_dir():
        raise FileNotFoundError(f"Production sites missing: {root}")
    manifest = root / "build-manifest.json"
    if not manifest.is_file():
        raise AssertionError("Missing signed-off build manifest")
    builds = json.loads(manifest.read_text())
    for framework in FRAMEWORKS:
        if framework not in builds.get("variants", {}):
            raise AssertionError(f"Missing comparator build: {framework}")
        for size in SCALES:
            if not (root / framework / str(size) / "index.html").is_file():
                raise AssertionError(f"Missing real SSR HTML: {framework}/{size}")
    serve = ThreadingHTTPServer(("127.0.0.1", 0),
        functools.partial(Handler, directory=str(root)))
    threading.Thread(target=serve.serve_forever, daemon=True).start()
    report = {
        "schema": "zaakiy.h4-hydration-evidence/1",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "head": args.head,
        "system": platform.platform(),
        "samplesPerCase": args.samples,
        "warmups": args.warmups,
        "metric": "browser performance.now() around native framework hydration",
        "comparators": builds,
        "cases": []
    }
    try:
        with sync_playwright() as pw:
            for engine in ENGINES:
                browser = getattr(pw, engine).launch(headless=True)
                try:
                    version = browser.version
                    for size in SCALES:
                        # Rotate order to mitigate repeatable runner warm-cache bias.
                        variants = FRAMEWORKS[(SCALES.index(size)+ENGINES.index(engine)) % 4:]
                        variants += FRAMEWORKS[:(SCALES.index(size)+ENGINES.index(engine)) % 4]
                        for framework in variants:
                            samples = []
                            mutation_counts = []
                            for iteration in range(args.samples + args.warmups):
                                page = browser.new_page(viewport={"width":1280,"height":900})
                                errors = []
                                page.on("pageerror", lambda err: errors.append(str(err)))
                                url = f"http://127.0.0.1:{serve.server_port}/{framework}/{size}/"
                                try:
                                    page.goto(url, wait_until="load", timeout=90000)
                                    page.wait_for_function(
                                        "window.__h4 && window.__h4.ready===true",
                                        timeout=args.timeout_ms)
                                    before = page.evaluate("""() => {
                                        const b = window.__h4;
                                        return {
                                          error:b.error,hydrationMs:b.hydrationMs,
                                          adopted:b.adopted,mutations:b.mutations,
                                          preservedDraft:b.preservedDraft,
                                          preservedFocus:b.preservedFocus,
                                          liveRows:b.liveRows
                                        };
                                    }""")
                                    if errors or before.get("error"):
                                        raise AssertionError(f"{framework}/{engine}/{size}: {errors} {before.get('error')}")
                                    for key in ("adopted", "preservedDraft", "preservedFocus"):
                                        if before.get(key) is not True:
                                            raise AssertionError(f"{framework}/{engine}/{size}: {key} invalid: {before}")
                                    if not isinstance(before.get("mutations"),int) or before["mutations"] < 0 or before.get("liveRows") != size:
                                        raise AssertionError(f"{framework}/{engine}/{size}: DOM replaced or wrong row count: {before}")
                                    duration = before.get("hydrationMs")
                                    if not isinstance(duration, (float, int)) or not math.isfinite(duration) or duration < 0:
                                        raise AssertionError(f"{framework}/{engine}/{size}: invalid hydration duration")
                                    changes = page.evaluate("""() => {
                                        const b=window.__h4;
                                        return Promise.resolve(b.update()).then(()=>b.reverse()).then(async()=>{
                                          const result=await Promise.resolve(b.verify());
                                          await Promise.resolve(b.dispose());
                                          const disposed=await Promise.resolve(b.verifyDisposed());
                                          return {result,disposed};
                                        });
                                    }""")
                                    if changes["result"] is not True or changes["disposed"] is not True:
                                        raise AssertionError(f"{framework}/{engine}/{size}: invalid interactions/disposal: {changes}")
                                    if iteration >= args.warmups:
                                        samples.append(duration)
                                        mutation_counts.append(before["mutations"])
                                finally:
                                    page.close()
                            case={
                                "framework":framework,"browser":engine,
                                "browserVersion":version,"size":size,
                                "hydrationMs":{"p50":percentile(samples,.50),
                                  "p95":percentile(samples,.95),
                                  "p99":percentile(samples,.99),
                                  "raw":samples},
                                "hydrationMutations":mutation_counts,
                                "correctness":"passed"
                            }
                            report["cases"].append(case)
                            print(json.dumps({k:v for k,v in case.items() if k!="hydrationMs"}))
                finally:
                    browser.close()
    finally:
        serve.shutdown()
    args.output.parent.mkdir(parents=True,exist_ok=True)
    args.output.write_text(json.dumps(report,indent=2)+"\n")
    if len(report["cases"]) != len(FRAMEWORKS)*len(SCALES)*len(ENGINES):
        raise AssertionError("Incomplete benchmark matrix")
    print("H4 HYDRATION MATRIX PASS",args.output)

if __name__=="__main__":
    parser=argparse.ArgumentParser()
    parser.add_argument("--site",type=Path,required=True)
    parser.add_argument("--output",type=Path,required=True)
    parser.add_argument("--head",required=True)
    parser.add_argument("--samples",type=int,default=50)
    parser.add_argument("--warmups",type=int,default=10)
    parser.add_argument("--timeout-ms",type=int,default=60000)
    params=parser.parse_args()
    if params.samples < 1 or params.warmups < 0: raise ValueError("Invalid benchmark samples")
    run(params)
