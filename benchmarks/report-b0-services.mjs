import {readFile,writeFile} from "node:fs/promises";
const [before,after]=await Promise.all(["before","after"].map(label=>
  readFile("benchmark-artifacts/b0-services-"+label+".json","utf8").then(JSON.parse)
));
const lines=[
  "# B0 Additional Public API Workloads",
  "",
  "These are matched Node 22 diagnostics; no real network, browser or React comparison is claimed.",
  "",
  "| Public API workload | Before p50 ms/op | Candidate p50 ms/op | Before p95 ms/op | Candidate p95 ms/op |",
  "| --- | ---: | ---: | ---: | ---: |"
];
if(before.schemaVersion!==1||after.schemaVersion!==1)throw Error("Unexpected B0 evidence version");
if(before.workloads.length!==4||after.workloads.length!==4)throw Error("Incomplete B0 workloads");
for(let i=0;i<4;i++){
  const b=before.workloads[i],a=after.workloads[i];
  if(b.name!==a.name||b.samples!==20||a.samples!==20||b.operationsPerSample!==a.operationsPerSample)
    throw Error("Incomparable B0 workload: "+i);
  for(const x of [a,b])if(!Number.isFinite(x.p50_ms_per_op)||!Number.isFinite(x.p95_ms_per_op))
    throw Error("Invalid B0 sample");
  lines.push("| "+a.name+" | "+b.p50_ms_per_op.toFixed(5)+" | "+a.p50_ms_per_op.toFixed(5)+" | "+
    b.p95_ms_per_op.toFixed(5)+" | "+a.p95_ms_per_op.toFixed(5)+" |");
}
lines.push("","Unchanged packages should show roughly similar performance; differences can reflect shared-host noise. These four are **new diagnostic baselines**, not proof of optimization.","");
await writeFile("benchmark-artifacts/b0-services-summary.md",lines.join("\n"));
console.log(lines.join("\n"));
