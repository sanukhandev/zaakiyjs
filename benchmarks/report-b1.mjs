import {readFile,writeFile} from "node:fs/promises";
const [before,after]=await Promise.all(["before","after"].map(
  tag=>readFile("benchmark-artifacts/b1-"+tag+".json","utf8").then(JSON.parse)
));
if(before.schemaVersion!==1||after.schemaVersion!==1)throw Error("Missing benchmark schema");
const lines=[
  "# B1 Forms and Analytics Before/After",
  "",
  "Frozen PR #62 baseline vs candidate. Measured in the same Node 22 CI job using identical compiled public APIs.",
  "A single GitHub-hosted run is exploratory; no significance or production throughput claims.",
  "",
  "| Workload | Size | Before p50 ms | After p50 ms | Change p50 | Before p95 ms | After p95 ms | Change p95 |",
  "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |"
];
const totals={};
for(const scenario of ["forms","analytics"]){
  const old=before[scenario],newer=after[scenario];
  if(old.length!==newer.length)throw Error("Fixture sizes differ");
  for(let i=0;i<old.length;i++){
    const b=old[i],a=newer[i];
    if(b.size!==a.size||b.n!==20||a.n!==20)throw Error("Invalid comparative sample");
    for(const x of [a,b])if(!Number.isFinite(x.p50_ms)||!Number.isFinite(x.p95_ms)||x.p50_ms<0||x.p95_ms<x.p50_ms)throw Error("Invalid recorded latency");
    const delta=(x,y)=>(x/y-1)*100;
    const signed=(x,y)=>y>0?delta(x,y).toFixed(1)+"%":"n/a";
    lines.push("| "+scenario+" | "+a.size+" | "+b.p50_ms.toFixed(3)+
      " | "+a.p50_ms.toFixed(3)+" | "+signed(a.p50_ms,b.p50_ms)+
      " | "+b.p95_ms.toFixed(3)+" | "+a.p95_ms.toFixed(3)+
      " | "+signed(a.p95_ms,b.p95_ms)+" |");
    totals[scenario+"-"+a.size]={p50DeltaPct:b.p50_ms?delta(a.p50_ms,b.p50_ms):null,
      p95DeltaPct:b.p95_ms?delta(a.p95_ms,b.p95_ms):null};
  }
}
lines.push("","Valid outcomes require all correctness checks to pass. Do not tune reported results to thresholds or omit slower scenarios.","");
await writeFile("benchmark-artifacts/b1-summary.md",lines.join("\n"));
await writeFile("benchmark-artifacts/b1-comparison.json",JSON.stringify({schemaVersion:1,metrics:totals},null,2)+"\n");
console.log(lines.join("\n"));
