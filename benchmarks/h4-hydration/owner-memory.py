#!/usr/bin/env python3
"""H4 native-owner 100-cycle GC/disposal certification.

This is a strict *ZaakiyJS owner-scope* retention test, not a comparable
cross-framework JS-heap ranking. Test adoption/disposal repeatedly in the SAME
browser document and request GC across separate browser tasks; WeakRef survival
checks are a stronger owner-leak signal than performance.memory quantization.
"""
import argparse
import functools
import json
import platform
import threading
from datetime import datetime, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from playwright.sync_api import sync_playwright

class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass

def check(args):
    root=args.site.resolve()
    for size in args.sizes:
        if not (root/"zaakiyjs"/str(size)/"index.html").is_file():
            raise FileNotFoundError(f"Missing verified H4 SSR: {size}")
    serve=ThreadingHTTPServer(("127.0.0.1",0),
        functools.partial(QuietHandler,directory=str(root)))
    threading.Thread(target=serve.serve_forever,daemon=True).start()
    report={"schema":"zaakiy.h4-owner-disposal/1",
        "head":args.head,"timestamp":datetime.now(timezone.utc).isoformat(),
        "system":platform.platform(),"ownerCycles":100,"cases":[]}
    try:
        with sync_playwright() as pw:
            for engine in ("chromium","firefox","webkit"):
                browser=getattr(pw,engine).launch(headless=True)
                try:
                    for size in args.sizes:
                        page=browser.new_page()
                        errors=[]
                        page.on("pageerror",lambda error:errors.append(str(error)))
                        try:
                            page.goto(f"http://127.0.0.1:{serve.server_port}/zaakiyjs/{size}/",
                                wait_until="load",timeout=90000)
                            page.wait_for_function("window.__h4?.ready===true",timeout=60000)
                            first=page.evaluate("window.__h4?.error??null")
                            if first: raise AssertionError(f"SSR mismatch {engine}/{size}: {first}")
                            # Clear first-mount metadata separately from 100-cycle stress.
                            page.request_gc()
                            baseline=page.evaluate("performance.memory?.usedJSHeapSize??null")
                            result=page.evaluate("""async()=>window.__h4.ownerStress(100)""")
                            if result!={"cycles":100,"leakedEvents":0,"wrongRoots":0,
                                         "remainingRows":size}:
                                raise AssertionError(f"Owner/listener stress failed: {engine}/{size}: {result}")
                            # The WeakRefs remain reachable; the OWNER OBJECTS must not.
                            retained=100
                            for _ in range(5):
                                page.request_gc()
                                retained=page.evaluate("""()=>{
                                  const refs=window.__h4OwnerWeakRefs;
                                  return refs.filter(ref=>ref.deref()!==undefined).length;
                                }""")
                                if retained==0:break
                            after=page.evaluate("performance.memory?.usedJSHeapSize??null")
                            if retained:
                                raise AssertionError(
                                    f"{engine}/{size}: {retained}/100 disposed native owners remain strongly reachable after requested GC")
                            if errors:raise AssertionError(f"Browser errors {engine}/{size}: {errors}")
                            report["cases"].append({
                                "browser":engine,"browserVersion":browser.version,
                                "size":size,"cycles":100,"disposedOwnerWeakRefsRetained":retained,
                                "staleEventCalls":result["leakedEvents"],
                                "incorrectAdoptedRoots":result["wrongRoots"],
                                "heapBeforeBytes":baseline,
                                "heapAfterBytes":after,
                                "heapInterpretation":"Nonstandard, GC-dependent diagnostics; not comparable across browser engines",
                                "correctness":"passed"})
                        finally:page.close()
                finally:browser.close()
    finally:serve.shutdown()
    args.output.parent.mkdir(parents=True,exist_ok=True)
    args.output.write_text(json.dumps(report,indent=2)+"\n")
    if len(report["cases"])!=3*len(args.sizes):
        raise AssertionError("Incomplete browser owner-retention matrix")
    print("H4 100-CYCLE OWNER RETENTION PASS",args.output)

if __name__=="__main__":
    parser=argparse.ArgumentParser()
    parser.add_argument("--site",required=True,type=Path)
    parser.add_argument("--output",required=True,type=Path)
    parser.add_argument("--head",required=True)
    parser.add_argument("--sizes",default="100,1000")
    options=parser.parse_args()
    options.sizes=tuple(int(s) for s in options.sizes.split(","))
    if not options.sizes or any(size not in (100,1000,10000) for size in options.sizes):
        raise ValueError("Invalid memory test scales")
    check(options)
