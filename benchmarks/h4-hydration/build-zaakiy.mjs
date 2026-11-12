/** Build real compiler-backed H4 server HTML + Vite hydration clients. */
import {resolve,join,dirname} from "node:path";
import {mkdir,writeFile,readFile} from "node:fs/promises";
import {createHash} from "node:crypto";
import {build} from "vite";
import {compileRegionServer} from "../../packages/compiler/dist/index.js";
import {buildVerifiedManifestV1} from "../../packages/ssr/dist/build.js";

const root=resolve(process.env.H4_SITE??"benchmark-artifacts/h4-hydration-sites");
const fixtureDir=resolve("benchmarks/h4-hydration/.generated");
const source=[
  'function Page(props:{count:number;shown:boolean;rows:{id:string;label:string}[];onCount:(event:MouseEvent)=>void}){',
  'return <main><input value="server"/><button type="button" onClick={props.onCount}>Count: {props.count}</button>',
  '{props.shown ? <p>Visible</p> : <p>Hidden</p>}',
  '<ul>{props.rows.map(item=><li key={item.id}>{item.label}</li>)}</ul></main>;}'
].join("\n");
const compiled=compileRegionServer({
  fileName:"benchmarks/h4-hydration/h4-benchmark.tsx",
  source,routeId:"h4benchmark",hydrationScale:"large"
});
if(compiled.diagnostics.some(x=>x.severity==="error") ||
  !compiled.hydrationPlan || !compiled.js[0])
  throw new Error("H4 benchmark compiler rejected source: "+JSON.stringify(compiled.diagnostics));
const plan=compiled.hydrationPlan;
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
  'const rows=Array.from({length:size},(_,i)=>({id:"row-"+i,label:"Row "+i}));',
  'const state=signal({count:0,shown:true,rows});',
  'const observe=new MutationObserver(()=>{});',
  'observe.observe(host,{subtree:true,childList:true,attributes:true,characterData:true});',
  'const before=performance.now();',
  'let actions=0;let handle;',
  'try{handle=hydrateRegionPage(host,plan,envelope,manifest,"h4benchmark",{',
  '  read:path=>state.value[path[0]],',
  '  resolveEvent:path=>{if(path.join(".")!=="onCount")throw Error("Unexpected event");',
  '    return ()=>{actions++;state.value={...state.value,count:state.value.count+1};};}});',
  '  const hydrationMs=performance.now()-before;',
  '  const mutations=observe.takeRecords().length;observe.disconnect();',
  '  window.__h4={ready:true,hydrationMs,mutations,',
  '    adopted:first.every((n,i)=>host.querySelectorAll("[data-key]")[i]===n),',
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
  '      return actions===old && host.querySelectorAll("[data-key]").length===size;}',
  '  };',
  '}catch(error){observe.disconnect();window.__h4={ready:true,error:String(error)};}'
].join("\n")+"\n");
await build({configFile:false,root:resolve("."),publicDir:false,logLevel:"warn",
  resolve:{alias:{"@zaakiyjs/ssr/client":resolve("packages/ssr/dist/client.js")}},
  build:{outDir:root,emptyOutDir:false,minify:"esbuild",
    lib:{entry:client,formats:["es"],fileName:"zaakiyjs"}}});
const variant={schema:"zaakiy.h4-reference/1",buildId:manifest.buildId,
  moduleSha256:createHash("sha256").update(bytes).digest("hex"),
  clientSha256:createHash("sha256").update(await readFile(join(root,"zaakiyjs.js"))).digest("hex"),
  generatedCases:[],rejectedCases:[]};
for(const size of [100,1000,10000]){
  const rows=Array.from({length:size},(_,i)=>({id:"row-"+i,label:"Row "+i}));
  try{
    const html=module.render({schema:"zaakiy.render/1",
      route:{id:"h4benchmark"},request:{signal:new AbortController().signal},
      loaderData:{count:0,shown:true,rows}}).body;
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
await writeFile(join(root,"zaakiyjs-build.json"),JSON.stringify(variant,null,2)+"\n");
console.log(JSON.stringify(variant));
