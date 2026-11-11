/* global AbortController, Response */
import {performance} from "node:perf_hooks";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {mkdir,writeFile} from "node:fs/promises";

const root=resolve(process.argv[2]??".");
const output=resolve(process.argv[3]??"benchmark-artifacts/b0-service-results.json");
const load=async n=>import(pathToFileURL(resolve(root,"packages",n,"dist/index.js")).href);
const [{composeSignals},{createHttpClient},{analyzeCompatibility,serializeManifest},{renderMetadata}] =
  await Promise.all(["async","http","compat","seo"].map(load));
const percentile=(values,f)=>{
  const v=[...values].sort((a,b)=>a-b),i=(v.length-1)*f,l=Math.floor(i),h=Math.ceil(i);
  return v[l]+(v[h]-v[l])*(i-l);
};
async function measure(name,operationsPerSample,run){
  const samples=[];
  for(let iteration=-5;iteration<20;iteration++){
    const started=performance.now();
    await run();
    const ms=(performance.now()-started)/operationsPerSample;
    if(!(Number.isFinite(ms)&&ms>=0))throw Error(name+" invalid timing");
    if(iteration>=0)samples.push(ms);
  }
  return {name,operationsPerSample,samples:20,p50_ms_per_op:percentile(samples,.5),
    p95_ms_per_op:percentile(samples,.95),samples_ms_per_op:samples};
}
const results={schemaVersion:1,node:process.version,sha:process.env.GITHUB_SHA??"local",
  note:"Diagnostic Node-only public API microbenchmarks (no real network or browser); same fixtures on frozen performance baseline and candidate",
  workloads:[]};
results.workloads.push(await measure("async/composeSignals-and-cleanup",1000,()=>{
  for(let i=0;i<1000;i++){
    const a=new AbortController(),b=new AbortController();
    const c=composeSignals([a.signal,b.signal]);
    if(c.signal.aborted)throw Error("Unexpected composed abort");
    c.dispose();
  }
}));
const client=createHttpClient({
  baseURL:"https://api.example.test/v1/",
  fetch:async()=>new Response('{"ok":true}',{status:200,headers:{"content-type":"application/json"}})
});
try {
  results.workloads.push(await measure("http/mock-fetch-json",100,async()=>{
    for(let i=0;i<100;i++){
      const value=await client.get("/item?id="+i);
      if(!value||value.ok!==true)throw Error("Invalid HTTP mock result");
    }
  }));
} finally{client.dispose();}
const source=Array.from({length:150},(_,i)=>"const n"+i+" = user?.field"+i+" ?? "+i+";").join("\n");
results.workloads.push(await measure("compat/150-source-features",1,()=>{
  const result=analyzeCompatibility({mode:"auto",targets:{profile:"modern-2024"},
    sources:[{fileName:"app.ts",source}]});
  if(!result.ok||!serializeManifest(result.manifest).includes("detectedFeatures"))
    throw Error("Incorrect compatibility manifest");
}));
results.workloads.push(await measure("seo/render-10-layer-metadata",100,()=>{
  for(let i=0;i<100;i++){
    const layers=Array.from({length:10},(_,index)=>({
      title:"Title-"+index,description:"Description "+index,canonical:"/product/"+i
    }));
    const result=renderMetadata(layers,{siteURL:"https://example.com",trailingSlash:"never"});
    if(result.metadata.canonical!=="https://example.com/product/"+i||
       !result.html.includes('rel="canonical"'))throw Error("Incorrect SEO metadata");
  }
}));
await mkdir(resolve(output,".."),{recursive:true});
await writeFile(output,JSON.stringify(results,null,2)+"\n");
for(const item of results.workloads)
  console.log(item.name,"p50",item.p50_ms_per_op.toFixed(5),"p95",item.p95_ms_per_op.toFixed(5),"ms/op");
