import {readFile,writeFile} from "node:fs/promises";
const [before,after]=await Promise.all(["before","after"].map(name=>
 readFile("benchmark-artifacts/b0-stage2-"+name+".json","utf8").then(JSON.parse)
));
if(before.schemaVersion!==1||after.schemaVersion!==1)throw Error("Incompatible B0 data");
const lines=[
 "# Additional B0 Package Benchmarks",
 "",
 "Matched Node-only public API workloads. No real upstream/network, browser, or React comparator; performance differences require independent replication.",
 "",
 "| Workload | Frozen PR62 p50 ms/op | New p50 ms/op | Frozen p95 | New p95 |",
 "| --- | ---: | ---: | ---: | ---: | ---: |"
];
if(before.workloads.length!==after.workloads.length||after.workloads.length!==5)
 throw Error("Incomplete B0 stage2 package coverage");
for(let i=0;i<after.workloads.length;i++){
 const b=before.workloads[i],a=after.workloads[i];
 if(a.name!==b.name||a.n!==20||b.n!==20||a.operationsPerSample!==b.operationsPerSample)
  throw Error("Cannot compare B0 stage2 fixture "+i);
 for(const v of [a,b])if(!Number.isFinite(v.p50_ms_per_op)||!Number.isFinite(v.p95_ms_per_op))
  throw Error("Nonfinite microbenchmark evidence");
 lines.push("| "+a.name+" | "+b.p50_ms_per_op.toFixed(5)+" | "+a.p50_ms_per_op.toFixed(5)+
  " | "+b.p95_ms_per_op.toFixed(5)+" | "+a.p95_ms_per_op.toFixed(5)+" |");
}
lines.push("","These measurements establish baselines for Proxy, Consent and Templates; package runtimes remain unchanged.","");
await writeFile("benchmark-artifacts/b0-stage2-summary.md",lines.join("\n"));
console.log(lines.join("\n"));
