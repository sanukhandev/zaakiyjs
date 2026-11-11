import {performance} from "node:perf_hooks";
import {resolve,join} from "node:path";
import {pathToFileURL} from "node:url";
import {mkdir,readFile,writeFile} from "node:fs/promises";

const root=resolve(process.argv[2]??".");
const output=resolve(process.argv[3]??"benchmark-artifacts/b0-stage2-results.json");
const mod=async n=>import(pathToFileURL(join(root,"packages",n,"dist","index.js")).href);
const [{createProxyRouter},{createConsentManager},{getTemplate,planTemplate,validateTemplate}] =
  await Promise.all(["proxy","consent","templates"].map(mod));
function stats(samples){
  if(samples.length!==20||samples.some(x=>!Number.isFinite(x)||x<0))throw Error("Invalid samples");
  const v=[...samples].sort((a,b)=>a-b);
  const at=f=>{const p=(v.length-1)*f,l=Math.floor(p),h=Math.ceil(p);return v[l]+(v[h]-v[l])*(p-l);};
  return {n:samples.length,p50_ms_per_op:at(.5),p95_ms_per_op:at(.95),samples_ms_per_op:samples};
}
async function time(name,count,task){
 const samples=[];
 for(let i=-3;i<20;i++){
  const start=performance.now();
  await task();
  const elapsed=(performance.now()-start)/count;
  if(i>=0)samples.push(elapsed);
 }
 const record={name,operationsPerSample:count,...stats(samples)};
 console.log(name,"p50",record.p50_ms_per_op.toFixed(5),"ms/op");
 return record;
}
const workloads=[];
for(const size of [10,100,500]){
 const router=createProxyRouter({
   upstreams:{main:{origin:"https://api.example.test"}},
   routes:Array.from({length:size},(_,i)=>({
     id:"r"+i,path:"/v1/route"+i,methods:["GET"],access:"public",upstream:"main"
   }))
 });
 const request={method:"GET",url:"/v1/unmatched",headers:{},remoteAddress:"127.0.0.1"};
 workloads.push(await time("proxy/no-match-"+size+"-routes",100,async()=>{
  for(let i=0;i<100;i++){
    const r=await router.handle(request);
    if(r.status!==404)throw Error("Unmatched request did not return 404");
    const buffers=[];
    if(r.body)for await(const chunk of r.body)buffers.push(Buffer.from(chunk));
    if(Buffer.concat(buffers).toString()!=='{"error":"NOT_FOUND"}')throw Error("Incorrect proxy miss body");
  }
 }));
}
const consent=createConsentManager({purposes:["analytics","advertising","ad-personalization"]});
await consent.ready;
try{
 workloads.push(await time("consent/grant-revoke-and-snapshot",200,()=>{
  for(let i=0;i<200;i++){
   consent.grant("analytics");
   if(!consent.isAllowed("analytics"))throw Error("Grant not authorized");
   consent.revoke("analytics");
   if(consent.isAllowed("analytics")||consent.snapshot().grants.analytics.decision==="granted")
     throw Error("Revocation failed");
  }
 }));
}finally{consent.dispose();}
const manifest=getTemplate("dashboard");
if(!manifest)throw Error("Missing dashboard template");
const files={};
for(const asset of manifest.assets){
 files[asset.path]=await readFile(join(root,"packages/templates/templates/dashboard",asset.path),"utf8");
}
if(validateTemplate(manifest,files).length)throw Error("Corrupt source template");
const vars={
 "__PROJECT_NAME__":"measured-app","__BRAND_NAME__":"Measured App",
 "__PRIMARY_COLOR__":"#aabbcc","__APPEARANCE__":"system","__RADIUS_VALUE__":"0.5rem"
};
workloads.push(await time("templates/dashboard-plan-14-assets",40,()=>{
 for(let i=0;i<40;i++){
  const plan=planTemplate({manifest,targetDirectory:"/approved-root",
    variables:vars,assetContents:files,existingPaths:[]});
  if(plan.diagnostics.length||plan.writes.length!==manifest.assets.length)
    throw Error("Invalid template output");
 }
}));
const evidence={schemaVersion:1,root,node:process.version,
  method:"Public API secure 404 route lookup, consent state transition, and checked immutable dashboard materialization plan; no real upstream/network or filesystem writes",
  workloads};
await mkdir(resolve(output,".."),{recursive:true});
await writeFile(output,JSON.stringify(evidence,null,2)+"\n");
