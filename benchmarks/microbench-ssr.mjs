/* global Request, AbortController */
import {performance} from "node:perf_hooks";
import {resolve,join} from "node:path";
import {pathToFileURL} from "node:url";
import {mkdir,writeFile} from "node:fs/promises";
const root=resolve(process.argv[2]??".");
const out=resolve(process.argv[3]??"benchmark-artifacts/ssr.json");
const {createNodeServerAdapter}=await import(pathToFileURL(join(root,"packages/ssr/dist/node.js")).href);
const pct=(x,p)=>{const v=[...x].sort((a,b)=>a-b),n=(v.length-1)*p,l=Math.floor(n),h=Math.ceil(n);return v[l]+(v[h]-v[l])*(n-l);};
const scenarios=[];
for(const count of [1,50]){
 const routes=[],policies=[],manifestRoutes={},modules={};
 for(let i=0;i<count;i++){
  const id="item"+i,moduleId="built/item"+i,sourceDigest="b".repeat(64);
  routes.push({id,path:"/products/p"+i+"/:slug",loader:({params})=>params.slug});
  policies.push({version:1,routeId:id,mode:"ssr"});
  manifestRoutes[id]={moduleId,sourceDigest,routeId:id};
  modules[moduleId]={sourceDigest,module:{protocol:"zaakiy.render/1",
   render:ctx=>({version:1,status:200,headers:{},
     body:"<main>"+String(ctx.loaderData)+"</main>",cache:{scope:"no-store",tags:[]}})
  }};
 }
 const adapter=createNodeServerAdapter({origin:"https://shop.example.test",routes,policies,
   manifest:{schema:"zaakiy.render-manifest/1",buildId:"a".repeat(64),irVersion:1,domAbiVersion:1,routes:manifestRoutes},
   modules});
 const path="/products/p"+(count-1)+"/safe";
 const samples=[];
 for(let k=-3;k<20;k++){
  const start=performance.now();
  for(let i=0;i<50;i++){
   const response=await adapter.handle(new Request("https://shop.example.test"+path),{
     signal:new AbortController().signal
   });
   if(response.status!==200||(await response.text())!=="<main>safe</main>")
     throw Error("SSR trusted response mismatch");
  }
  if(k>=0)samples.push((performance.now()-start)/50);
 }
 const record={routes:count,samples:20,warmups:3,
  p50_ms_per_request:pct(samples,.5),p95_ms_per_request:pct(samples,.95),
  samples_ms_per_request:samples};
 scenarios.push(record);
 console.log("ssr",count,"routes p50",record.p50_ms_per_request.toFixed(4),"ms");
}
await mkdir(resolve(out,".."),{recursive:true});
await writeFile(out,JSON.stringify({schemaVersion:1,node:process.version,
 method:"Trusted no-store server rendering, Core owner lifecycle, dynamic loader, no external IO or full TSX hydration",scenarios},null,2)+"\n");
