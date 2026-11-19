import {performance} from "node:perf_hooks";
import {resolve,join} from "node:path";
import {pathToFileURL} from "node:url";
import {mkdir,writeFile} from "node:fs/promises";
const root=resolve(process.argv[2]??".");
const out=resolve(process.argv[3]??"benchmark-artifacts/motion.json");
const {createSpring}=await import(pathToFileURL(join(root,"packages/motion/dist/index.js")).href);
const pct=(x,p)=>{const v=[...x].sort((a,b)=>a-b),n=(v.length-1)*p,l=Math.floor(n),h=Math.ceil(n);return v[l]+(v[h]-v[l])*(n-l);};
const priorRaf=globalThis.requestAnimationFrame,priorCancel=globalThis.cancelAnimationFrame;
let nextId=0;const queued=new Map();
globalThis.requestAnimationFrame=cb=>{const id=++nextId;queued.set(id,cb);return id;};
globalThis.cancelAnimationFrame=id=>{queued.delete(id);};
const scenarios=[];
try{
 for(const [label,stiffness,damping] of [["default",170,26],["stiff",900,60]]){
  const samples=[];let frameCount=0;
  for(let k=-3;k<20;k++){
   const start=performance.now(),operations=20;
   for(let i=0;i<operations;i++){
    let value=0,updates=0,frame=0;
    const handle=createSpring({
     from:0,to:1,stiffness,damping,reducedMotion:"force",
     onUpdate:x=>{if(!Number.isFinite(x))throw Error("Non-finite spring value");value=x;updates++;}
    });
    let now=0;
    while(handle.status==="running"&&frame<400){
     const tasks=[...queued.values()];
     queued.clear();
     now+=16.667;
     for(const fn of tasks)fn(now);
     frame++;
    }
    const finished=await handle.finished;
    if(finished.status!=="finished"||value!==1||updates<2||queued.size)
     throw Error("Spring completion or RAF cleanup failed");
    if(k===0)frameCount+=frame;
   }
   if(k>=0)samples.push((performance.now()-start)/operations);
  }
  const record={label,stiffness,damping,samples:20,warmups:3,frameCountFirstSample:frameCount,
    p50_ms_per_spring:pct(samples,.5),p95_ms_per_spring:pct(samples,.95),
    samples_ms_per_spring:samples};
  scenarios.push(record);
  console.log("motion spring",label,"p50",record.p50_ms_per_spring.toFixed(5),"ms");
 }
}finally{
 if(priorRaf===undefined)delete globalThis.requestAnimationFrame;
 else globalThis.requestAnimationFrame=priorRaf;
 if(priorCancel===undefined)delete globalThis.cancelAnimationFrame;
 else globalThis.cancelAnimationFrame=priorCancel;
}
await mkdir(resolve(out,".."),{recursive:true});
await writeFile(out,JSON.stringify({schemaVersion:1,node:process.version,
 method:"Deterministically stepped spring physics and controlled animation cleanup, fake RAF (not a browser frame benchmark)",scenarios},null,2)+"\n");
