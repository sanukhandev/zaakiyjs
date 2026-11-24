import {readFile,writeFile} from "node:fs/promises";
const [base,optimized]=await Promise.all(["baseline","candidate"].map(name=>
  readFile("benchmark-artifacts/proxy-"+name+".json","utf8").then(JSON.parse)
));
if(base.schemaVersion!==1||optimized.schemaVersion!==1||base.scenarios.length!==6||
 optimized.scenarios.length!==6)throw Error("Incomplete proxy comparison evidence");
const lines=[
  "# Secure Proxy route lookup — before and after",
  "",
  "Frozen PR #63 against this candidate; same Node 22 Linux runner, 30 recorded samples × 100 operations per workload. No external network calls.",
  "",
  "| Workload | Routes | Baseline p50 ms | Candidate p50 ms | Change p50 | Baseline p95 ms | Candidate p95 ms |",
  "| --- | ---: | ---: | ---: | ---: | ---: | ---: |"
];
for(let i=0;i<6;i++){
  const b=base.scenarios[i],a=optimized.scenarios[i];
  if(b.name!==a.name||b.routes!==a.routes||b.measuredSamples!==30||a.measuredSamples!==30)throw Error("Non-equivalent Proxy benchmark");
  for(const row of [b,a]){
    if(row.samples_ms_per_request.length!==30||!row.samples_ms_per_request.every(Number.isFinite)||row.p95_ms_per_request<row.p50_ms_per_request)
      throw Error("Invalid latency sample");
  }
  const change=(a.p50_ms_per_request/b.p50_ms_per_request-1)*100;
  lines.push("| "+a.name+" | "+a.routes+" | "+b.p50_ms_per_request.toFixed(5)+
    " | "+a.p50_ms_per_request.toFixed(5)+" | "+change.toFixed(1)+"% | "+
    b.p95_ms_per_request.toFixed(5)+" | "+a.p95_ms_per_request.toFixed(5)+" |");
}
lines.push("","This benchmark isolates 404/405 routing. Successful forwarding, authn/authz, SSRF protection, cancellation and streaming correctness are separately verified by package and integration suites.",
  "A single shared-host run is directional; do not claim production throughput without repeated independent evidence.","");
await writeFile("benchmark-artifacts/proxy-comparison.md",lines.join("\n"));
console.log(lines.join("\n"));
