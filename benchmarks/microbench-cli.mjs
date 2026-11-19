import {performance} from "node:perf_hooks";
import {createHash} from "node:crypto";
import {resolve,join} from "node:path";
import {pathToFileURL} from "node:url";
import {mkdir,writeFile} from "node:fs/promises";
const root=resolve(process.argv[2]??".");
const out=resolve(process.argv[3]??"benchmark-artifacts/cli.json");
const {scaffoldPlan}=await import(pathToFileURL(join(root,"packages/cli/dist/index.js")).href);
const versions={core:"workspace:^",dom:"workspace:^",signals:"workspace:^",
 styles:"workspace:^","vite-plugin":"workspace:^"};
const pct=(x,p)=>{const v=[...x].sort((a,b)=>a-b),n=(v.length-1)*p,l=Math.floor(n),h=Math.ceil(n);return v[l]+(v[h]-v[l])*(n-l);};
const scenarios=[];
for(const [preset,expected] of [["minimal",11],["standard",13],["enterprise",16]]){
 const samples=[];
 let sha="";
 for(let sample=-3;sample<20;sample++){
  const start=performance.now();
  for(let iteration=0;iteration<5;iteration++){
   const files=await scaffoldPlan("measured-app",preset,"pnpm",versions);
   if(files.length!==expected||files.some(f=>f.content.includes("__PROJECT_NAME__")))throw Error("Invalid CLI scaffold");
   const fingerprint=createHash("sha256").update(files.map(f=>f.path+"\0"+f.content).join("\0")).digest("hex");
   if(sha&&sha!==fingerprint)throw Error("Non-reproducible CLI output");
   sha=fingerprint;
  }
  if(sample>=0)samples.push((performance.now()-start)/5);
 }
 const row={preset,files:expected,sha256:sha,samples:20,warmups:3,
  p50_ms_per_plan:pct(samples,.5),p95_ms_per_plan:pct(samples,.95),samples_ms_per_plan:samples};
 scenarios.push(row);
 console.log("cli scaffold",preset,"p50",row.p50_ms_per_plan.toFixed(3),"ms");
}
await mkdir(resolve(out,".."),{recursive:true});
await writeFile(out,JSON.stringify({schemaVersion:1,node:process.version,
 method:"Read-only, hash-verified CLI scaffold plans for minimal/standard/enterprise presets with workspace-pinned versions",scenarios},null,2)+"\n");
