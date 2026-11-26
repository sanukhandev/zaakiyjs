#!/usr/bin/env python3
"""Untimed native-browser validation of the separate application-mode build."""
import argparse
import functools
import json
import threading
from pathlib import Path
from http.server import ThreadingHTTPServer
from playwright.sync_api import sync_playwright
from measure import Handler

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--site",type=Path,required=True)
    parser.add_argument("--engine",choices=("chromium","firefox","webkit"),required=True)
    parser.add_argument("--output",type=Path,required=True)
    args=parser.parse_args()
    server=ThreadingHTTPServer(("127.0.0.1",0),functools.partial(Handler,directory=str(args.site.resolve())))
    threading.Thread(target=server.serve_forever,daemon=True).start()
    results=[]
    try:
        with sync_playwright() as pw:
            browser=getattr(pw,args.engine).launch(headless=True)
            try:
                for size in (100,1000,10000):
                    page=browser.new_page()
                    errors=[]
                    page.on("pageerror",lambda error:errors.append(str(error)))
                    try:
                        page.goto(f"http://127.0.0.1:{server.server_port}/clean-production/{size}/",wait_until="load")
                        page.wait_for_function("Boolean(window.zaakiyApp)",timeout=60000)
                        result=page.evaluate("""size=>{
                          const host=document.querySelector("#app");
                          const check=(value,message)=>{if(!value)throw Error(message);};
                          const rows=Array.from({length:size},(_,i)=>({id:"row_"+i,label:"Row "+i}));
                          const original=[...host.querySelectorAll("[data-key]")];
                          const input=host.querySelector("input"),button=host.querySelector("button");
                          check(original.length===size,"initial rows");
                          input.value="visitor draft";input.focus();
                          button.click();
                          window.zaakiyApp.updateRows([...rows].reverse());
                          check(button.textContent==="Count: 1","counter event");
                          const reversed=host.querySelectorAll("[data-key]");
                          check(reversed[0]===original[size-1]&&reversed[size-1]===original[0],"reverse identity");
                          check(document.activeElement===input&&input.value==="visitor draft","focus or draft");
                          window.zaakiyApp.updateRows([{id:"row_"+(size-1),label:"<updated>"},{id:"new",label:"Added"}]);
                          const updated=host.querySelectorAll("[data-key]");
                          check(updated.length===2&&updated[0]===original[size-1]&&updated[0].textContent==="<updated>"&&updated[1].textContent==="Added","replace/add/remove");
                          window.zaakiyApp.setShown(false);
                          check(host.querySelector("p")?.textContent==="Hidden","conditional change");
                          window.zaakiyApp.dispose();
                          const markup=host.innerHTML;
                          button.click();window.zaakiyApp.updateRows([]);
                          check(host.innerHTML===markup,"post-disposal mutation");
                          return {size,correctness:"passed",retainedRows:updated.length};
                        }""",size)
                        if errors:
                            raise AssertionError(f"Clean production errors: {errors}")
                        results.append(result)
                    finally:
                        page.close()
            finally:
                browser.close()
    finally:
        server.shutdown()
        server.server_close()
    args.output.parent.mkdir(parents=True,exist_ok=True)
    args.output.write_text(json.dumps({"schema":"zaakiy.h4-clean-production/1","engine":args.engine,"cases":results},indent=2)+"\n")

if __name__=="__main__":
    main()
