import {performance} from "node:perf_hooks";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {mkdir,writeFile} from "node:fs/promises";

const root=resolve(process.argv[2] ?? ".");
const output=resolve(process.argv[3] ?? "benchmark-artifacts/b1-results.json");
const file=relative=>pathToFileURL(resolve(root,relative)).href;
const {createForm}=await import(file("packages/forms/dist/index.js"));
const {createAnalytics}=await import(file("packages/analytics/dist/index.js"));
const textEncoder=new TextEncoder();
const summary=(samples)=>{
  if(!samples.length||samples.some(x=>!Number.isFinite(x)||x<0))throw Error("Invalid benchmark measurements");
  const v=[...samples].sort((a,b)=>a-b);
  const percentile=p=>{const i=(v.length-1)*p,l=Math.floor(i),h=Math.ceil(i);return v[l]+(v[h]-v[l])*(i-l);};
  return {n:samples.length,p50_ms:percentile(.5),p95_ms:percentile(.95),mean_ms:samples.reduce((a,b)=>a+b,0)/samples.length,samples_ms:samples};
};
async function forms(size){
  const names=Array.from({length:size},(_,i)=>"field"+i);
  const initialValues=Object.fromEntries(names.map(n=>[n,"content"]));
  const issues=names.map(n=>({code:"mismatch",path:n,message:"Invalid "+n,source:"form"}));
  issues.push({code:"global",message:"Global issue",source:"form"});
  const form=createForm({initialValues,validators:[()=>issues]});
  const fields=names.map(n=>form.field(n));
  const samples=[];
  try{
    for(let run=-3;run<20;run++){
      const start=performance.now();
      const result=await form.validate();
      const elapsed=performance.now()-start;
      if(result.status!=="invalid"||result.issues.length!==size+1)throw Error("Wrong form validation status/count");
      if(form.errors.value.length!==size+1)throw Error("Wrong total errors");
      for(let i=0;i<size;i++){
        const own=fields[i].errors.value;
        if(own.length!==1||own[0].path!==names[i])throw Error("Cross-field error misallocated "+i);
      }
      if(run>=0)samples.push(elapsed);
    }
  } finally{form.dispose();}
  return {size,validations:23,...summary(samples)};
}
const PURPOSES=["essential","analytics","advertising","ad-personalization","functional-third-party"];
const grants=Object.fromEntries(PURPOSES.map(p=>[p,{purpose:p,decision:p==="analytics"?"granted":"denied"}]));
const consent={
  schema:"zaakiy.consent/1",
  snapshot:()=>({schema:"zaakiy.consent/1",revision:1,policyId:"bench",policyVersion:"v1",grants}),
  can:p=>p==="analytics",
  subscribe:()=>()=>{}
};
async function analytics(size){
  const samples=[];
  const policy={version:1,sampleRate:1,maxBatchSize:size,maxQueueSize:1000,maxPayloadBytes:65536,
    flushIntervalMs:60000,delivery:"fetch",requiredPurposes:["analytics"]};
  for(let run=-3;run<20;run++){
    let sent=0,bytes=0;
    const provider={version:1,start:async()=>{},send:async records=>{
      const wire=textEncoder.encode(JSON.stringify({events:records})).length;
      if(wire>65536)throw Error("Exceeded wire payload limit");
      sent+=records.length;bytes+=wire;
    },flush:async()=>{},dispose:async()=>{}};
    const engine=createAnalytics({
      schemas:{viewed:{fields:["productId"],validate:value=>value!==null&&typeof value==="object"&&
        typeof value.productId==="string"}},
      consent,providers:[{id:"memory",purpose:"analytics",load:()=>provider}],policy
    });
    try{
      for(let i=0;i<size;i++){
        if(engine.track("viewed",{productId:"sku-"+i})!==true)throw Error("Event rejected");
      }
      const start=performance.now();
      await engine.flush();
      const elapsed=performance.now()-start;
      if(sent!==size||engine.diagnostics().queueLength!==0||bytes<1)throw Error("Loss/duplication in analytics flush");
      if(run>=0)samples.push(elapsed);
    } finally{await engine.dispose();}
  }
  return {size,flushes:23,...summary(samples)};
}
const sizes={forms:[30,100,300,700],analytics:[50,200,400]};
const results={schemaVersion:1,commit:process.env.GITHUB_SHA??"local",node:process.version,
  method:"Whole form.validate() with one form issue per registered field; analytics consented queue flush (no network), exact wire-size check",
  forms:[],analytics:[]};
for(const size of sizes.forms){
  const result=await forms(size);
  results.forms.push(result);
  console.log("forms",size,"p50",result.p50_ms.toFixed(3),"p95",result.p95_ms.toFixed(3),flush=true);
}
for(const size of sizes.analytics){
  const result=await analytics(size);
  results.analytics.push(result);
  console.log("analytics",size,"p50",result.p50_ms.toFixed(3),"p95",result.p95_ms.toFixed(3));
}
await mkdir(resolve(output,".."),{recursive:true});
await writeFile(output,JSON.stringify(results,null,2)+"\n");
