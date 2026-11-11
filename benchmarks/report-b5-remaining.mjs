import {readFile,writeFile} from "node:fs/promises";
const plans=[
 {name:"ads",cases:2,key:"count",metric:"slot"},
 {name:"cli",cases:3,key:"preset",metric:"plan"},
 {name:"ssr",cases:2,key:"routes",metric:"request"},
 {name:"motion",cases:2,key:"label",metric:"spring"},
 {name:"ui",cases:4,key:"type",metric:"component"}
];
const lines=["# B5 — Five additional package baselines","","Matched pure public-API workloads using pinned Node 22. No package runtime code is changed by this phase; small differences are host noise.","",
"| Package | Workload | Baseline p50 ms/op | Candidate p50 ms/op | Baseline p95 | Candidate p95 |",
"| --- | --- | ---: | ---: | ---: | ---: |"];
for(const config of plans){
 const [base,after]=await Promise.all(["baseline","candidate"].map(x=>
  readFile("benchmark-artifacts/"+config.name+"-"+x+".json","utf8").then(JSON.parse)
 ));
 if(base.schemaVersion!==1||after.schemaVersion!==1||
    base.scenarios.length!==config.cases||after.scenarios.length!==config.cases)
   throw Error("Incomplete "+config.name+" performance fixtures");
 const p50="p50_ms_per_"+config.metric,p95="p95_ms_per_"+config.metric,raw="samples_ms_per_"+config.metric;
 for(let i=0;i<config.cases;i++){
  const a=after.scenarios[i],b=base.scenarios[i];
  const workload=JSON.stringify({
   key:a[config.key],count:a.count??null,
   damping:a.damping??null
  });
  if(a[config.key]!==b[config.key]||a.count!==b.count||
     a.samples!==b.samples||a.damping!==b.damping)
     throw Error("Mismatch in "+config.name+" case "+i);
  for(const v of [a,b]){
   if(!Number.isFinite(v[p50])||!Number.isFinite(v[p95])||
      v[p95]<v[p50]||!Array.isArray(v[raw])||
      v[raw].length!==v.samples||!v[raw].every(Number.isFinite))
     throw Error("Invalid "+config.name+" measurements");
  }
  if(config.name==="cli"&&a.sha256!==b.sha256)
    throw Error("CLI changed immutable output hashes");
  if(config.name==="motion"&&a.frameCountFirstSample!==b.frameCountFirstSample)
    throw Error("Motion changed integration frame semantics");
  if(config.name==="ads"&&a.outputCharacters!==b.outputCharacters)
    throw Error("Ads output geometry or text escaped differently");
  lines.push("| "+config.name+" | "+workload+" | "+b[p50].toFixed(5)+" | "+a[p50].toFixed(5)+
   " | "+b[p95].toFixed(5)+" | "+a[p95].toFixed(5)+" |");
 }
}
lines.push("","These are deliberately matched diagnostic baselines for unoptimized runtimes. JSDOM is not a browser rendering or Core Web Vitals reference; Motion uses a deterministic fake RAF.","");
await writeFile("benchmark-artifacts/b5-summary.md",lines.join("\n"));
console.log(lines.join("\n"));
