import {performance} from "node:perf_hooks";
import {createHash} from "node:crypto";
import {gzipSync} from "node:zlib";
import {mkdtemp,mkdir,writeFile,rm} from "node:fs/promises";
import {join,resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {build} from "vite";
import {Buffer} from "node:buffer";

const root=resolve(process.argv[2]??".");
const outputFile=resolve(process.argv[3]??"benchmark-artifacts/vite-production.json");
const {zaakiyPlugin}=await import(pathToFileURL(join(root,"packages/vite-plugin/dist/index.js")).href);
function instrumentPlugin(plugin, metrics) {
  const transform = plugin.transform;
  const generateBundle = plugin.generateBundle;
  if (typeof transform !== "function" || typeof generateBundle !== "function") {
    throw new Error("Vite plugin hook contract changed; phase instrumentation must be updated");
  }
  plugin.transform = async function (...args) {
    const start = performance.now();
    try { return await transform.apply(this, args); }
    finally {
      if (/\.[cm]?tsx(?:\?|$)/.test(args[1] ?? "")) {
        metrics.transformMs += performance.now() - start;
        metrics.transformCalls++;
      }
    }
  };
  plugin.generateBundle = async function (...args) {
    const start = performance.now();
    try { return await generateBundle.apply(this, args); }
    finally {
      metrics.cssGenerateMs += performance.now() - start;
      metrics.cssGenerateCalls++;
    }
  };
  return plugin;
}
const percentile=(items,f)=>{
  const values=[...items].sort((a,b)=>a-b),x=(values.length-1)*f,low=Math.floor(x),high=Math.ceil(x);
  return values[low]+(values[high]-values[low])*(x-low);
};
async function generate(count){
  const folder=await mkdtemp(join(root,".benchmark-vite-"));
  await mkdir(join(folder,"src"),{recursive:true});
  await writeFile(join(folder,"index.html"),'<!doctype html><html lang="en"><head><meta charset="utf-8"></head><body><main id="app"></main><script type="module" src="/src/main.js"></script></body></html>');
  const imports=[];
  for(let i=0;i<count;i++){
    const name="component-"+i+".tsx";
    imports.push('import "./'+name+'";');
    await writeFile(join(folder,"src",name),
      'import {signal} from "@zaakiyjs/signals";\n'+
      'import {mount} from "@zaakiyjs/dom";\n'+
      'const clicks=signal(0);\n'+
      'mount(() => <button class="flex gap-4 p-4" onClick={() => clicks.value++}>Count: {clicks.value}</button>, document.getElementById("app")!);\n');
  }
  await writeFile(join(folder,"src/main.js"),imports.join("\n")+"\n");
  return folder;
}
async function measure(count){
  const project=await generate(count),samples=[],profiles=[];
  let assetHash="",outputGzipBytes=0;
  try{
    for(let i=-1;i<4;i++){
      const metrics={transformMs:0,transformCalls:0,cssGenerateMs:0,cssGenerateCalls:0};
      const start=performance.now();
      const result=await build({
        configFile:false,
        root:project,
        plugins:[instrumentPlugin(zaakiyPlugin(),metrics)],
        logLevel:"silent",
        build:{write:false,emptyOutDir:false,sourcemap:false,minify:true}
      });
      const elapsed=performance.now()-start;
      const bundle=Array.isArray(result)?result[0]:result;
      if(!bundle||!Array.isArray(bundle.output))throw Error("Missing Vite Rollup output");
      const assets=bundle.output.map(entry=>({
        name:entry.fileName,
        content:entry.type==="chunk"?entry.code:Buffer.from(entry.source).toString()
      })).sort((a,b)=>a.name.localeCompare(b.name));
      if(!assets.some(item=>item.name==="zaakiy-assets.json"))throw Error("No Zaakiy asset manifest");
      if(!assets.some(item=>item.name==="assets/zaakiy-styles.css"))throw Error("No Zaakiy styles");
      const hash=createHash("sha256");
      for(const item of assets)hash.update(item.name+"\0"+item.content+"\0");
      const checksum=hash.digest("hex");
      if(assetHash&&checksum!==assetHash)throw Error("Non-reproducible production build at "+count+" modules");
      assetHash=checksum;
      outputGzipBytes=assets.filter(item=>item.name.endsWith(".js")||item.name.endsWith(".css"))
        .reduce((sum,item)=>sum+gzipSync(item.content).length,0);
      if(i>=0){samples.push(elapsed);profiles.push(metrics);}
    }
  }finally{await rm(project,{recursive:true,force:true});}
  const record={modules:count,samples:4,warmups:1,
    p50_ms:percentile(samples,.5),p95_ms:percentile(samples,.95),
    assetSha256:assetHash,appJsCssGzipBytes:outputGzipBytes,
    samples_ms:samples,
    transformP50_ms:percentile(profiles.map(p=>p.transformMs),.5),
    cssGenerationP50_ms:percentile(profiles.map(p=>p.cssGenerateMs),.5),
    transformCalls:profiles.map(p=>p.transformCalls),
    cssGenerationCalls:profiles.map(p=>p.cssGenerateCalls),
    profiles};
  console.log("vite",count,"modules p50",record.p50_ms.toFixed(2),"ms, gzip",outputGzipBytes);
  return record;
}
const scenarios=[];
for(const count of [1,8,24])scenarios.push(await measure(count));
const report={schemaVersion:1,node:process.version,root,scenarios,
  method:"B8 real Vite production builds with measured Zaakiy plugin transform time and CSS generation time; attribution is inclusive and excludes external Vite/Rollup phases"};
await mkdir(resolve(outputFile,".."),{recursive:true});
await writeFile(outputFile,JSON.stringify(report,null,2)+"\n");
