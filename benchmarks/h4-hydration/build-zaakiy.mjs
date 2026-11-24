/** Build real compiler-backed H4 server HTML + Vite hydration clients. */
import {resolve,join,dirname,relative} from "node:path";
import {mkdir,writeFile,readFile,readdir} from "node:fs/promises";
import {createHash} from "node:crypto";
import {gzipSync,brotliCompressSync} from "node:zlib";
import {build} from "vite";
import {compileRegionServer} from "../../packages/compiler/dist/index.js";
import {buildVerifiedManifestV1} from "../../packages/ssr/dist/build.js";

const root=resolve(process.env.H4_SITE??"benchmark-artifacts/h4-hydration-sites");
const fixtureDir=resolve("benchmarks/h4-hydration/.generated");
const source=[
  'function Page(props:{count:number;shown:boolean;rows:{id:string;label:string}[];onCount:(event:MouseEvent)=>void}){',
  'return <main><input/><button type="button" onClick={props.onCount}>Count: {props.count}</button>',
  '{props.shown ? <p>Visible</p> : <p>Hidden</p>}',
  '<ul>{props.rows.map(item=><li key={item.id} data-key="row">{item.label}</li>)}</ul></main>;}'
].join("\n");
const requestedMarkerFormat=process.env.H4_MARKER_FORMAT??"compact-v3";
if(!["compact-v2","compact-v3"].includes(requestedMarkerFormat))throw Error("Unsupported H4 requested format");
const compiled=compileRegionServer({
  fileName:"benchmarks/h4-hydration/h4-benchmark.tsx",
  source,routeId:"h4benchmark",hydrationScale:"large",hydrationMarkerFormat:requestedMarkerFormat
});
if(compiled.diagnostics.some(x=>x.severity==="error") ||
  !compiled.hydrationPlan || !compiled.js[0])
  throw new Error("H4 benchmark compiler rejected source: "+JSON.stringify(compiled.diagnostics));
const plan=compiled.hydrationPlan;
const dataIds=new Map(),keyedIds=[];
const indexMarkers=nodes=>{
  for(const node of nodes){
    if(node.kind==="data")dataIds.set(node.id.slice(0,16),node.id);
    else if(node.kind==="keyed"){keyedIds.push(node.id);indexMarkers(node.rows);}
    else if(node.kind==="element"||node.kind==="component")indexMarkers(node.children);
    else if(node.kind==="conditional"){indexMarkers(node.yes);indexMarkers(node.no);}
  }
};
indexMarkers(plan.nodes);
if(plan.limits && keyedIds.length!==1)
  throw new Error("Marker size comparison requires one unambiguous compiler keyed region");
const sizeOf=value=>{
  const buf=Buffer.from(value);
  return {raw:buf.length,gzip:gzipSync(buf,{level:9}).length,brotli:brotliCompressSync(buf).length};
};
const markerImpact={};
const previousMarkerFormat=html=>html
  .replace(/<!--z-d:([0-9a-f]{16}):([se])-->/g,(_,prefix,end)=>{
    const id=dataIds.get(prefix);
    if(!id)throw new Error("Unknown compact data marker");
    return "<!--zaakiy-d2:"+id+":"+(end==="s"?"start":"end")+"-->";
  })
  .replace(/<!--z-k:([A-Za-z0-9_.:]{1,64}):([se])-->/g,(_,key,end)=>
    "<!--zaakiy-k2:"+keyedIds[0]+":"+key+":"+(end==="s"?"start":"end")+"-->");

const bytes=Buffer.from(compiled.js[0].code);
const module=await import("data:text/javascript;base64,"+bytes.toString("base64"));
const manifest=buildVerifiedManifestV1([
  {routeId:"h4benchmark",moduleId:"benchmarks/h4",bytes}
]);
const envelope={schema:"zaakiy.hydration/1",buildId:manifest.buildId,
  routeId:"h4benchmark",domAbiVersion:1,payload:null,
  boundaries:[{markerId:plan.markerId,templateDigest:plan.templateDigest}]};
await mkdir(fixtureDir,{recursive:true});
const client=join(fixtureDir,"zaakiy-client.mjs");
await writeFile(client,[
  'import {hydrateRegionPage} from "@zaakiyjs/ssr/client";',
  'import {signal,flushSync} from "@zaakiyjs/signals";',
  'const plan='+JSON.stringify(plan)+';',
  'const manifest='+JSON.stringify(manifest)+';',
  'const envelope='+JSON.stringify(envelope)+';',
  'const host=document.querySelector("#app");const size=Number(host.dataset.size);',
  'const first=[...host.querySelectorAll("[data-key]")];',
  'const input=host.querySelector("input");const button=host.querySelector("button");',
  'input.value="visitor draft";input.focus();',
  'const rows=Array.from({length:size},(_,i)=>({id:"row_"+i,label:"Row "+i}));',
  'const state=signal({count:0,shown:true,rows});',
  'const observe=new MutationObserver(()=>{});',
  'observe.observe(host,{subtree:true,childList:true,attributes:true,characterData:true});',
  'const before=performance.now();',
  'let actions=0;let handle;',
  'try{handle=hydrateRegionPage(host,plan,envelope,manifest,"h4benchmark",{',
  '  itemDataMode:"snapshot",read:path=>state.value[path[0]],',
  '  resolveEvent:path=>{if(path.join(".")!=="onCount")throw Error("Unexpected event");',
  '    return ()=>{actions++;state.value={...state.value,count:state.value.count+1};};}});',
  '  const hydrationMs=performance.now()-before;',
  '  const mutations=observe.takeRecords().length;observe.disconnect();',
  '  const adoptedRows=host.querySelectorAll("[data-key]");',
  '  window.__h4={ready:true,hydrationMs,mutations,',
  '    adopted:adoptedRows.length===first.length&&first.every((n,i)=>adoptedRows[i]===n),',
  '    preservedDraft:input.value==="visitor draft",',
  '    preservedFocus:document.activeElement===input,',
  '    get liveRows(){return host.querySelectorAll("[data-key]").length;},',
  '    update(){flushSync(()=>{state.value={...state.value,count:state.value.count+1};});},',
  '    reverse(){flushSync(()=>{state.value={...state.value,rows:[...state.value.rows].reverse()};});},',
  '    verify(){const items=host.querySelectorAll("[data-key]");',
  '      return host.querySelector("button")?.textContent==="Count: 1" &&',
  '        items.length===size && items[0]===first[size-1] &&',
  '        items[size-1]===first[0] && input.value==="visitor draft";},',
  '    dispose(){handle.dispose();},',
  '    verifyDisposed(){const old=actions;button.click();',
  '      return actions===old && host.querySelectorAll("[data-key]").length===size;},',
  '    async ownerStress(cycles=100){',
  '      if(!Number.isInteger(cycles)||cycles<1||cycles>100)throw Error("Invalid stress budget");',
  '      if(handle){handle.dispose();handle=undefined;}',
  '      const ownerRefs=[];let leakedEvents=0;let wrongRoots=0;',
  '      const baseline=host.childNodes[1];',
  '      const attach={itemDataMode:"snapshot",read:path=>state.value[path[0]],resolveEvent:path=>{',
  '        if(path.join(".")!=="onCount")throw Error("Unexpected event");',
  '        return ()=>{actions++;};}};',
  '      for(let i=0;i<cycles;i++){',
  '        let current=hydrateRegionPage(host,plan,envelope,manifest,"h4benchmark",attach);',
  '        ownerRefs.push(new WeakRef(current.owner));',
  '        if(current.root!==baseline)wrongRoots++;',
  '        current.dispose();current=undefined;',
  '        const before=actions;button.click();if(actions!==before)leakedEvents++;',
  '        if(i%10===9)await new Promise(resolve=>setTimeout(resolve,0));',
  '      }',
  '      window.__h4OwnerWeakRefs=ownerRefs;',
  '      return {cycles,leakedEvents,wrongRoots,remainingRows:host.querySelectorAll("[data-key]").length};',
  '    }',
  '  };',
  '}catch(error){observe.disconnect();window.__h4={ready:true,error:String(error)};}'
].join("\n")+"\n");
const attribution=[];
await build({configFile:false,root:resolve("."),publicDir:false,logLevel:"warn",
  plugins:[{name:"h4-module-attribution",generateBundle(_options,bundle){
    for(const [file,chunk] of Object.entries(bundle)){
      if(chunk.type!=="chunk")continue;
      for(const [id,info] of Object.entries(chunk.modules)){
        attribution.push({file,module:id.charCodeAt(0)===0?id:relative(resolve("."),id),
          renderedBytes:info.renderedLength,originalBytes:info.originalLength});
      }
    }
  }}],
  resolve:{alias:{"@zaakiyjs/ssr/client":resolve("packages/ssr/dist/client.js")}},
  build:{outDir:root,emptyOutDir:false,minify:"esbuild",
    lib:{entry:client,formats:["es"],fileName:"zaakiyjs"}}});
await writeFile(join(root,"zaakiy-module-attribution.json"),JSON.stringify({
  schema:"zaakiy.h4-module-attribution/1",
  metric:"Rollup rendered module lengths before final chunk compression; not additive gzip attribution",
  modules:attribution.sort((a,b)=>b.renderedBytes-a.renderedBytes || a.module.localeCompare(b.module))
},null,2)+"\n");
const variant={schema:"zaakiy.h4-reference/1",buildId:manifest.buildId,
  markerFormat:plan.markerFormat??"standard",requestedMarkerFormat,requestedItemDataMode:"snapshot",
  moduleSha256:createHash("sha256").update(bytes).digest("hex"),
  clientSha256:createHash("sha256").update(await readFile(join(root,"zaakiyjs.js"))).digest("hex"),
  generatedCases:[],rejectedCases:[]};
for(const size of [100,1000,10000]){
  const rows=Array.from({length:size},(_,i)=>({id:"row_"+i,label:"Row "+i}));
  try{
    const html=module.render({schema:"zaakiy.render/1",
      route:{id:"h4benchmark"},request:{signal:new AbortController().signal},
      loaderData:{count:0,shown:true,rows}}).body;
    const compact=sizeOf(html);
    const expanded=sizeOf(previousMarkerFormat(html));
    markerImpact[size]=["compact-v2","compact-v3"].includes(plan.markerFormat) ? {
      compact,comparison:"Compare actual paired build HTML; omitted scalar and keyed markers cannot be recovered by marker replacement alone."
    } : {
      compact,unoptimizedV2Markers:expanded,
      savedRawBytes:expanded.raw-compact.raw,
      savedGzipBytes:expanded.gzip-compact.gzip,
      savedBrotliBytes:expanded.brotli-compact.brotli
    };
    if(plan.limits && !["compact-v2","compact-v3"].includes(plan.markerFormat) && compact.raw>=expanded.raw)
      throw new Error("H4 compact markers did not reduce raw SSR payload");
    const output=join(root,"zaakiyjs",String(size),"index.html");
    await mkdir(dirname(output),{recursive:true});
    await writeFile(output,'<!doctype html><html><head><meta charset="utf-8"><title>H4 ZaakiyJS</title></head>'+
      '<body><div id="app" data-size="'+size+'">'+html+'</div>'+
      '<script type="module" src="../../zaakiyjs.js"></script></body></html>');
    variant.generatedCases.push(size);
  }catch(error){
    variant.rejectedCases.push({size,error:String(error)});
  }
}
variant.markerImpact=markerImpact;
// Keep the full historical harness unchanged as a comparison metric.
// Independently measure an ordinary application build without timing,
// MutationObserver, WeakRef, test assertion or stress instrumentation.
const cleanClient=join(fixtureDir,"zaakiy-clean.mjs");
await writeFile(cleanClient,[
  'import {hydrateRegionPage} from "@zaakiyjs/ssr/client";',
  'import {signal,flushSync} from "@zaakiyjs/signals";',
  'const plan='+JSON.stringify(plan)+';',
  'const manifest='+JSON.stringify(manifest)+';',
  'const envelope='+JSON.stringify(envelope)+';',
  'const host=document.querySelector("#app");const size=Number(host.dataset.size);',
  'const rows=Array.from({length:size},(_,i)=>({id:"row_"+i,label:"Row "+i}));',
  'const state=signal({count:0,shown:true,rows});',
  'const handle=hydrateRegionPage(host,plan,envelope,manifest,"h4benchmark",{',
  'itemDataMode:"snapshot",read:path=>state.value[path[0]],',
  'resolveEvent:path=>{if(path.join(".")!=="onCount")throw Error("Unexpected event");',
  'return ()=>{state.value={...state.value,count:state.value.count+1};};}});',
  'window.zaakiyApp={updateRows(rows){flushSync(()=>{state.value={...state.value,rows};});},',
  'setShown(shown){flushSync(()=>{state.value={...state.value,shown};});},',
  'dispose(){handle.dispose();}};'
].join("\n")+"\n");
const cleanDir=join(root,"clean-production");
const cleanAttribution=[];
await build({configFile:false,root:resolve("."),publicDir:false,logLevel:"warn",
  plugins:[{name:"h4-clean-module-attribution",generateBundle(_options,bundle){
    for(const [file,chunk] of Object.entries(bundle))if(chunk.type==="chunk")
      for(const [id,info] of Object.entries(chunk.modules))
        cleanAttribution.push({file,module:id.charCodeAt(0)===0?id:relative(resolve("."),id),
          renderedBytes:info.renderedLength,originalBytes:info.originalLength});
  }}],
  resolve:{alias:{"@zaakiyjs/ssr/client":resolve("packages/ssr/dist/client.js")}},
  build:{outDir:cleanDir,emptyOutDir:true,minify:"esbuild",
    rollupOptions:{input:cleanClient,output:{entryFileNames:"app.js",chunkFileNames:"assets/[name]-[hash].js"}}}});
const cleanFiles=async dir=>{
  const paths=[];
  for(const entry of await readdir(dir,{withFileTypes:true})){
    const file=join(dir,entry.name);
    if(entry.isDirectory())paths.push(...await cleanFiles(file));
    else if(entry.isFile()&&/\.(?:js|css)$/.test(entry.name))paths.push(file);
  }
  return paths.sort();
};
const cleanAssets={};const cleanTotals={raw:0,gzip:0,brotli:0};
for(const file of await cleanFiles(cleanDir)){
  const content=await readFile(file);const sizes=sizeOf(content);
  cleanAssets[relative(cleanDir,file)]={...sizes,sha256:createHash("sha256").update(content).digest("hex")};
  for(const kind of Object.keys(cleanTotals))cleanTotals[kind]+=sizes[kind];
}
if(!cleanAssets["app.js"])throw Error("Missing clean production entry");
variant.cleanProduction={metric:"Application-mode JS/CSS, excludes benchmark instrumentation; separate from historical H4",
  assets:cleanAssets,bundleBytes:cleanTotals};
await writeFile(join(root,"zaakiy-clean-attribution.json"),JSON.stringify({
  schema:"zaakiy.h4-module-attribution/1",metric:"Rollup rendered lengths, not additive gzip",
  modules:cleanAttribution.sort((a,b)=>b.renderedBytes-a.renderedBytes || a.module.localeCompare(b.module))
},null,2)+"\n");
for(const size of variant.generatedCases){
  const html=await readFile(join(root,"zaakiyjs",String(size),"index.html"),"utf8");
  const output=join(cleanDir,String(size),"index.html");
  await mkdir(dirname(output),{recursive:true});
  await writeFile(output,html.replace('src="../../zaakiyjs.js"','src="../app.js"'));
}

await writeFile(join(root,"zaakiyjs-build.json"),JSON.stringify(variant,null,2)+"\n");
console.log(JSON.stringify(variant));
