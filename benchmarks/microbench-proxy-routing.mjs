import {performance} from "node:perf_hooks";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {mkdir,writeFile} from "node:fs/promises";
import {Buffer} from "node:buffer";

const root=resolve(process.argv[2]??".");
const output=resolve(process.argv[3]??"benchmark-artifacts/proxy-routing.json");
const {createProxyRouter}=await import(pathToFileURL(resolve(root,"packages/proxy/dist/index.js")).href);
const percent=(values,p)=>{
  const v=[...values].sort((a,b)=>a-b),x=(v.length-1)*p;
  const a=Math.floor(x),b=Math.ceil(x);
  return v[a]+(v[b]-v[a])*(x-a);
};
async function run(name,count,mode){
  const routes=Array.from({length:count},(_,i)=>({
    id:"resource-"+i,path:"/v1/resource-"+i,methods:["GET"],access:"public",upstream:"main"
  }));
  const router=createProxyRouter({upstreams:{main:{origin:"https://example.invalid"}},routes});
  const path=mode==="method"?"/v1/resource-"+(count-1):"/v1/nonexistent";
  const input={method:mode==="method"?"PATCH":"GET",url:path,headers:{},remoteAddress:"127.0.0.1"};
  const samples=[];
  for(let sample=-5;sample<30;sample++){
    const start=performance.now();
    for(let j=0;j<100;j++){
      const result=await router.handle(input);
      if(result.status!==(mode==="method"?405:404))throw Error(name+" incorrect routing status");
      if(mode==="method"&&result.headers.allow!=="GET")throw Error("405 Allow changed");
      const chunks=[];
      if(result.body)for await(const chunk of result.body)chunks.push(Buffer.from(chunk));
      if(!Buffer.concat(chunks).toString().includes(mode==="method"?"METHOD_NOT_ALLOWED":"NOT_FOUND"))
        throw Error("Missing safe response payload");
    }
    if(sample>=0)samples.push((performance.now()-start)/100);
  }
  const result={name,routes:count,measuredSamples:30,operationsPerSample:100,
    p50_ms_per_request:percent(samples,.5),
    p95_ms_per_request:percent(samples,.95),
    samples_ms_per_request:samples};
  console.log(name,"p50",result.p50_ms_per_request.toFixed(5),"p95",result.p95_ms_per_request.toFixed(5));
  return result;
}
const scenarios=[];
for(const size of [10,100,500]){
  scenarios.push(await run("miss-"+size,size,"miss"));
  scenarios.push(await run("method-"+size,size,"method"));
}
const report={schemaVersion:1,node:process.version,root,
  workload:"Secured route parsing and match selection, 404/405 responses (no external IO), identical public APIs and safe wire body checks",
  scenarios};
await mkdir(resolve(output,".."),{recursive:true});
await writeFile(output,JSON.stringify(report,null,2)+"\n");
