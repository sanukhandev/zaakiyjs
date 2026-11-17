import {performance} from "node:perf_hooks";
import {createHash} from "node:crypto";
import {mkdir,writeFile} from "node:fs/promises";
import {dirname,join,resolve} from "node:path";
import {pathToFileURL} from "node:url";

const root=resolve(process.argv[2]??".");
const out=resolve(process.argv[3]??"benchmark-artifacts/cli-generators.json");
const {generatorPlan}=await import(pathToFileURL(join(root,"packages/cli/dist/index.js")).href);

function percentile(samples,p){
 const ordered=[...samples].sort((a,b)=>a-b);
 const index=(ordered.length-1)*p,lower=Math.floor(index),upper=Math.ceil(index);
 return ordered[lower]+(ordered[upper]-ordered[lower])*(index-lower);
}
const scenarios=[];
for(const spec of [
 {kind:"page",name:"SalesReports",path:"src/pages/SalesReportsPage.tsx"},
 {kind:"layout",name:"Dashboard",path:"src/layouts/DashboardLayout.tsx"},
 {kind:"store",name:"Cart",path:"src/stores/createCartStore.ts"},
 {kind:"resource",name:"Products",path:"src/resources/createProductsResource.ts"},
 {kind:"task",name:"SaveProduct",path:"src/tasks/createSaveProductTask.ts"},
 {kind:"interceptor",name:"Trace",path:"src/interceptors/createTraceInterceptor.ts"},
 {kind:"proxy",name:"Gateway",path:"server/proxies/createGatewayProxy.ts"}
]){
 const samples=[];
 let fingerprint="";
 for(let sample=-3;sample<20;sample++){
  const started=performance.now();
  for(let iteration=0;iteration<250;iteration++){
   const files=generatorPlan(spec.kind,spec.name);
   if(files.length!==1||files[0].path!==spec.path)throw Error("Generator output shape mismatch: "+spec.kind);
   if(files[0].content.includes("dangerouslySetInnerHTML")||files[0].content.includes("props.children"))
    throw Error("Unsafe/unsupported JSX in generated "+spec.kind);
   const next=createHash("sha256").update(files[0].path+"\u0000"+files[0].content).digest("hex");
   if(fingerprint&&fingerprint!==next)throw Error("Non-deterministic generator output: "+spec.kind);
   fingerprint=next;
  }
  if(sample>=0)samples.push((performance.now()-started)/250);
 }
 const p50=percentile(samples,.5),p95=percentile(samples,.95),p99=percentile(samples,.99);
 if(p95>10)throw Error("CLI "+spec.kind+" plan exceeded 10ms p95 safety ceiling");
 scenarios.push({kind:spec.kind,sha256:fingerprint,warmups:3,sampleCount:20,
  iterationsPerSample:250,p50_ms:p50,p95_ms:p95,p99_ms:p99,samples_ms:samples});
 console.log(spec.kind,"p50",p50.toFixed(4),"ms; p95",p95.toFixed(4),"ms");
}
await mkdir(dirname(out),{recursive:true});
await writeFile(out,JSON.stringify({schemaVersion:1,node:process.version,
 method:"Read-only CLI generator-plan microbenchmark: 3 warmups, 20 samples, 250 plans each; deterministic SHA-256 assertions; Node CPU, not application/browser startup",scenarios},null,2)+"\n");
