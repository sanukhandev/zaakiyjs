#!/usr/bin/env python3
"""Merge exactly three independently measured browser reports; fail closed."""
import argparse
import json
from datetime import datetime,timezone
from pathlib import Path

FRAMEWORKS=("zaakiyjs","react","vue","angular")
BROWSERS=("chromium","firefox","webkit")
SIZES=(100,1000,10000)

def merge(source:Path,output:Path,head:str):
    reports=[]
    for browser in BROWSERS:
        file=source/("h4-hydration-"+browser+".json")
        if not file.is_file():raise AssertionError("Missing browser evidence: "+str(file))
        reports.append(json.loads(file.read_text()))
    original=reports[0]
    reference=original.get("comparators")
    if not reference or not reference.get("variants"):raise AssertionError("Missing comparator identities")
    cases=[]
    seen=set()
    for report,browser in zip(reports,BROWSERS):
        if report.get("head")!=head or report.get("samplesPerCase")!=50 or report.get("warmups")!=10:
            raise AssertionError("Inconsistent benchmark head, sample count or warmups")
        if report.get("comparators")!=reference:
            raise AssertionError("Inconsistent dependency/bundle manifest across browser workers")
        if len(report.get("cases",[]))!=len(FRAMEWORKS)*len(SIZES):
            raise AssertionError("Missing per-browser framework/scale cases for "+browser)
        for case in report["cases"]:
            pair=(case.get("framework"),case.get("browser"),case.get("size"))
            if pair[1]!=browser or pair[0] not in FRAMEWORKS or pair[2] not in SIZES or pair in seen:
                raise AssertionError("Unexpected or duplicated browser case "+str(pair))
            seen.add(pair)
            timings=case.get("hydrationMs",{})
            if len(timings.get("raw",[]))!=50 or case.get("correctness")!="passed":
                raise AssertionError("Missing raw timings or failed correctness: "+str(pair))
            if len(case.get("hydrationMutations",[]))!=50:
                raise AssertionError("Missing mutation samples: "+str(pair))
            for metric in ("p50","p95","p99"):
                if not isinstance(timings.get(metric),(int,float)) or timings[metric]<0:
                    raise AssertionError("Invalid hydration percentile: "+str(pair))
            cases.append(case)
    expected={(a,b,s) for a in FRAMEWORKS for b in BROWSERS for s in SIZES}
    if seen!=expected:raise AssertionError("Full 36-case hydration matrix incomplete")
    result={**original,"timestamp":datetime.now(timezone.utc).isoformat(),
        "status":"PASS","cases":sorted(cases,key=lambda c:(
            BROWSERS.index(c["browser"]),SIZES.index(c["size"]),FRAMEWORKS.index(c["framework"]))),
        "totalCases":36}
    output.parent.mkdir(parents=True,exist_ok=True)
    output.write_text(json.dumps(result,indent=2)+"\n")
    print("PASS: exactly 36 validated production SSR hydration cases, 50 measurements each")

if __name__=="__main__":
    parser=argparse.ArgumentParser()
    parser.add_argument("--source",type=Path,required=True)
    parser.add_argument("--output",type=Path,required=True)
    parser.add_argument("--head",required=True)
    args=parser.parse_args()
    merge(args.source,args.output,args.head)
