import {performance} from "node:perf_hooks";
import {resolve,join} from "node:path";
import {pathToFileURL} from "node:url";
import {mkdir,writeFile} from "node:fs/promises";
const root=resolve(process.argv[2]??".");
const out=resolve(process.argv[3]??"benchmark-artifacts/ads.json");
const {renderAdSlotPlaceholderV1}=await import(pathToFileURL(join(root,"packages/ads/dist/index.js")).href);
const pct=(x,p)=>{
  const v=[...x].sort((a,b)=>a-b),n=(v.length-1)*p,i=Math.floor(n),j=Math.ceil(n);
  return v[i]+(v[j]-v[i])*(n-i);
};
const cases=[];
for(const count of [100,1000]){
  const slots=Array.from({length:count},(_,i)=>({
    schema:"zaakiy.ads/1",id:"placement-"+i,
    reserve:{minWidth:300,minHeight:250,aspectRatio:1.2}
  }));
  const samples=[];
  let bytes=0;
  for(let n=-3;n<25;n++){
    const start=performance.now();
    let total=0;
    for(const slot of slots){
      const html=renderAdSlotPlaceholderV1(slot,'Advertisement & offers');
      if(!html.includes('aria-label="Advertisement &amp; offers"')||
         !html.includes('data-zaakiy-ad-slot="'+slot.id+'"')||
         html.includes("<script"))throw Error("Incorrect privacy-safe placeholder");
      total+=html.length;
    }
    const elapsed=(performance.now()-start)/count;
    if(n>=0)samples.push(elapsed);
    if(n===0)bytes=total;
  }
  const result={count,outputCharacters:bytes,samples:25,warmups:3,
    p50_ms_per_slot:pct(samples,.5),p95_ms_per_slot:pct(samples,.95),
    samples_ms_per_slot:samples};
  cases.push(result);
  console.log("ads placeholder",count,"p50",result.p50_ms_per_slot.toFixed(6),"ms/slot");
}
await mkdir(resolve(out,".."),{recursive:true});
await writeFile(out,JSON.stringify({schemaVersion:1,node:process.version,method:"Pure validated privacy-neutral SSR ad placeholders with escaped accessible labels and stable geometry",scenarios:cases},null,2)+"\n");
