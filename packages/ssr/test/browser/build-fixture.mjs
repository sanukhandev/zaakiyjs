/**
 * H6 Node/CI fixture: emit real compiler-authored server HTML and a Vite
 * client bundle referencing @zaakiyjs/ssr/client, never a browser compiler.
 */
import { resolve, join } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { Buffer } from "node:buffer";
import { TextEncoder } from "node:util";
import { build } from "vite";
import { compileDataServer, compileRegionServer } from "../../../compiler/dist/index.js";
import { buildVerifiedManifestV1 } from "../../dist/build.js";
import { serializeHydrationState } from "../../dist/hydration-state.js";

const root = resolve(".");
const routeId = "counter";
const source = [
  "function Counter(props: { count: number }) {",
  'return <main class="counter"><button type="button">Count: {props.count}</button><input value="server"></input></main>;',
  "}"
].join("\n");
const compiled = compileDataServer({
  fileName: "packages/ssr/test/browser/counter.tsx",
  routeId, source, hydratable: true
});
if (compiled.diagnostics.some(d => d.severity === "error") ||
    !compiled.js[0] || !compiled.hydrationPlan) {
  throw new Error("Compiler failed to generate the hydration fixture");
}
const moduleBytes = new TextEncoder().encode(compiled.js[0].code);
const generatedUrl = "data:text/javascript;base64," +
  Buffer.from(moduleBytes).toString("base64");
const generated = await import(generatedUrl);
if (generated.protocol !== "zaakiy.render/1" ||
    JSON.stringify(generated.hydrationPlan) !== JSON.stringify(compiled.hydrationPlan))
  throw new Error("Compiled module and hydration plan differ");
const response = generated.render({
  schema: "zaakiy.render/1",
  route: { id: routeId },
  request: { signal: new globalThis.AbortController().signal },
  loaderData: { count: 0 }
});
if (response.status !== 200 || typeof response.body !== "string")
  throw new Error("Unexpected server fixture response");
const manifest = buildVerifiedManifestV1([
  { routeId, moduleId: "generated/counter", bytes: moduleBytes }
]);
const envelope = {
  schema: "zaakiy.hydration/1", buildId: manifest.buildId,
  domAbiVersion: 1, routeId, payload: null,
  boundaries: [{
    markerId: compiled.hydrationPlan.markerId,
    templateDigest: compiled.hydrationPlan.templateDigest
  }]
};
const fixtureDir = join(root, "packages/ssr/.hydration-fixture");
const distDir = join(root, "benchmark-artifacts/hydration-browser");
await mkdir(fixtureDir, { recursive: true });
await mkdir(distDir, { recursive: true });
const code = [
  'import { hydrateDataPage } from "@zaakiyjs/ssr/client";',
  'import { signal, flushSync } from "@zaakiyjs/signals";',
  "const plan = " + JSON.stringify(compiled.hydrationPlan) + ";",
  "const manifest = " + JSON.stringify(manifest) + ";",
  "const envelope = " + JSON.stringify(envelope) + ";",
  "const originalHtml = " + JSON.stringify(response.body) + ";",
  'const container = document.querySelector("#app");',
  'const button = container.querySelector("button");',
  'const input = container.querySelector("input");',
  'const originalElements = [...container.querySelectorAll("*")];',
  'const originalText = [...button.childNodes].find(n => n.nodeType === 3 && n.nodeValue === "0");',
  'const buttonPlan = plan.root.children.find(x => x.kind === "element" && x.tag === "button");',
  'const count = signal(0);',
  'const read = path => path.join(".") === "count" ? count.value : null;',
  'input.value = "visitor draft";',
  'input.focus();',
  'input.setSelectionRange(2, 5);',
  'const observer = new MutationObserver(() => {});',
  'observer.observe(container, { subtree: true, childList: true, attributes: true, characterData: true });',
  'let clicked = 0;',
  'let handle;',
  'try {',
  '  const started = performance.now();',
  '  handle = hydrateDataPage(container, plan, envelope, manifest, "counter", {',
  '    read, events: [{ elementId: buttonPlan.id, name: "click", handler() {',
  '      clicked++; count.value++; flushSync();',
  '    } }]',
  '  });',
  '  const adoptionMs = performance.now() - started;',
  '  const mutations = observer.takeRecords().length;',
  '  const identity = originalElements.every((node,i) => node === container.querySelectorAll("*")[i]);',
  '  const preservedFocus = document.activeElement === input;',
  '  const preservedSelection = input.selectionStart === 2 && input.selectionEnd === 5;',
  '  const preservedDraft = input.value === "visitor draft";',
  '  const stableText = originalText && originalText.nodeValue === "0";',
  '  const samples = [];',
  '  const perSample = 1000;',
  '  for(let batch=-2;batch<20;batch++){',
  '    const targets = Array.from({length:perSample}, () => {',
  '      const temp = document.createElement("div"); temp.innerHTML = originalHtml; return temp;',
  '    });',
  '    const handles = [];',
  '    const start = performance.now();',
  '    for(const temp of targets) handles.push(hydrateDataPage(temp, plan, envelope, manifest, "counter", { read: () => 0 }));',
  '    const elapsed = (performance.now() - start) / perSample;',
  '    for(const childHandle of handles) childHandle.dispose();',
  '    if(batch >= 0) samples.push(elapsed);',
  '  }',
  '  samples.sort((a,b) => a-b);',
  '  const percentile = f => {',
  '    const n=(samples.length-1)*f, low=Math.floor(n), high=Math.ceil(n);',
  '    return samples[low]+(samples[high]-samples[low])*(n-low);',
  '  };',
  '  window.__zaakiyHydration = {',
  '    ready:true, adoptionMs, p50Ms:percentile(.5), p95Ms:percentile(.95),',
  '    samples, iterationsPerSample:perSample, warmups:2, mutations, identity, preservedFocus, preservedSelection, preservedDraft, stableText,',
  '    get clicks(){ return clicked; },',
  '    get buttonText(){ return button.textContent; },',
  '    get textIdentity(){ return [...button.childNodes].includes(originalText); },',
  '    dispose:() => handle.dispose()',
  '  };',
  '} catch(error) { window.__zaakiyHydration = { ready:true, error:String(error) }; }',
  'finally { observer.disconnect(); }'
].join("\n");
const entryPath = join(fixtureDir, "entry.ts");
await writeFile(entryPath, code);
await build({
  configFile: false, root, publicDir: false, logLevel: "warn",
  build: {
    outDir: distDir, emptyOutDir: true, minify: "esbuild",
    lib: { entry: entryPath, formats: ["es"], fileName: "hydration" }
  }
});
await writeFile(join(distDir, "index.html"),
  '<!doctype html><html><head><meta charset="utf-8"><title>Native hydration test</title></head>' +
  '<body><div id="app">' + response.body +
  '</div><script type="module" src="./hydration.js"></script></body></html>');
console.log(JSON.stringify({
  routeId, markerId: compiled.hydrationPlan.markerId,
  buildId: manifest.buildId, htmlBytes: response.body.length
}));


// H4 independent real-browser integration: compiled component/conditional/keyed plan.
const h4Route = "products";
const h4Source = [
  'function Badge(props: {title:string}) {return <span>{props.title}</span>;}',
  'function Page(props: { title:string;shown:boolean;rows:{id:string;label:string}[];onPress:(event:MouseEvent)=>void }) {',
  'return <main><input value="server"/><Badge title={props.title}/>',
  '{props.shown ? <h2>Shown</h2> : <p>Hidden</p>}',
  '{props.rows.map(item=><button key={item.id} onClick={props.onPress}>{item.label}</button>)}</main>;',
  '}'
].join("\n");
const h4Compiled = compileRegionServer({
  fileName:"packages/ssr/test/browser/h4-page.tsx",
  routeId:h4Route,source:h4Source
});
if (h4Compiled.diagnostics.some(d=>d.severity==="error") ||
    !h4Compiled.js[0] || !h4Compiled.hydrationPlan)
  throw new Error("H4 compiler browser fixture failed: "+
    JSON.stringify(h4Compiled.diagnostics));
const h4Bytes = new TextEncoder().encode(h4Compiled.js[0].code);
const h4Server = await import("data:text/javascript;base64,"+
  Buffer.from(h4Bytes).toString("base64"));
const h4Data={title:"Initial",shown:true,
  rows:[{id:"a",label:"Alpha"},{id:"b",label:"Beta"}]};
const h4Response=h4Server.render({
  schema:"zaakiy.render/1",route:{id:h4Route},
  request:{signal:new globalThis.AbortController().signal},
  loaderData:h4Data
});
const h4Manifest=buildVerifiedManifestV1([
  {routeId:h4Route,moduleId:"generated/products",bytes:h4Bytes}
]);
const h4Envelope={
  schema:"zaakiy.hydration/1",buildId:h4Manifest.buildId,
  domAbiVersion:1,routeId:h4Route,payload:null,
  boundaries:[{markerId:h4Compiled.hydrationPlan.markerId,
    templateDigest:h4Compiled.hydrationPlan.templateDigest}]
};
const h4SerializedState=serializeHydrationState(h4Manifest.buildId,h4Route,h4Data);
const h4Code=[
  'import { hydrateRegionPage, hydrateRegionPageWithState } from "@zaakiyjs/ssr/client";',
  'import { signal, flushSync } from "@zaakiyjs/signals";',
  "const plan="+JSON.stringify(h4Compiled.hydrationPlan)+";",
  "const manifest="+JSON.stringify(h4Manifest)+";",
  "const envelope="+JSON.stringify(h4Envelope)+";",
  "const serialized="+JSON.stringify(h4SerializedState)+";",
  "let state;let clicks=0;let released=0;",
  'const container=document.querySelector("#app");',
  'const root=container.querySelector("main");',
  'const badge=container.querySelector("span");',
  'const buttons=[...container.querySelectorAll("button")];',
  'const input=container.querySelector("input");',
  'input.value="visitor draft";input.focus();',
  'const read=path=>state.value[path[0]];',
  'let handle;',
  'try {',
  '  const observer=new MutationObserver(()=>{});',
  '  observer.observe(container,{subtree:true,childList:true,attributes:true,characterData:true});',
  '  handle=hydrateRegionPageWithState(container,plan,envelope,manifest,"products",serialized,publicState=>{',
  '    state=signal(publicState);return {read,disposeState:()=>{released++;},',
  '      resolveEvent:path=>{if(path.join(".")!=="onPress")throw Error("unapproved event");',
  '        return ()=>{clicks++;};}};',
  '  });',
  '  const mutations=observer.takeRecords().length;observer.disconnect();',
  '  buttons[1].click();const eventAttached=clicks===1;',
  '  const identity=container.querySelector("main")===root && container.querySelector("span")===badge',
  '    && [...container.querySelectorAll("button")].every((node,i)=>node===buttons[i]);',
  '  const focus=document.activeElement===input && input.value==="visitor draft";',
  '  flushSync(()=>{state.value={...state.value,title:"Updated",shown:false,',
  '    rows:[state.value.rows[1],state.value.rows[0]]};});',
  '  const moved=container.querySelectorAll("button")[0]===buttons[1] &&',
  '    container.querySelectorAll("button")[1]===buttons[0];',
  '  const switched=container.querySelector("p")?.textContent==="Hidden" &&',
  '    container.querySelector("h2")===null;',
  '  const updated=badge.textContent==="Updated" && input.value==="visitor draft";',
  '  const focusAfter=document.activeElement===input;',
  '  flushSync(()=>{state.value={...state.value,shown:true,rows:[',
  '    {id:"b",label:"Beta changed"},{id:"c",label:"Gamma"}]};});',
  '  const reused=container.querySelectorAll("button")[0]===buttons[1];',
  '  const addition=container.querySelectorAll("button")[1]?.textContent==="Gamma";',
  '  const changed=container.querySelectorAll("button")[0]?.textContent==="Beta changed";',
  '  const returned=container.querySelector("h2")?.textContent==="Shown";',
  '  handle.dispose();',
  '  buttons[1].click();const eventRemoved=clicks===1 && released===1;',
  '  const preserved=container.querySelector("main")===root &&',
  '    input.value==="visitor draft";',
  '  const second=hydrateRegionPage(container,plan,envelope,manifest,"products",{read});',
  '  second.dispose();',
  '  window.__zaakiyH4={ready:true,mutations,identity,focus,moved,switched,',
  '    updated,focusAfter,reused,addition,changed,returned,preserved,',
  '    eventAttached,eventRemoved,',
  '    lastState:container.querySelectorAll("button").length};',
  '}catch(error){window.__zaakiyH4={ready:true,error:String(error)};}'
].join("\n");
const h4Entry=join(fixtureDir,"h4-entry.ts");
await writeFile(h4Entry,h4Code);
await build({
  configFile:false,root,publicDir:false,logLevel:"warn",
  build:{outDir:distDir,emptyOutDir:false,minify:"esbuild",
    lib:{entry:h4Entry,formats:["es"],fileName:"h4"}}
});
await writeFile(join(distDir,"h4.html"),
  '<!doctype html><html><head><meta charset="utf-8"><title>H4 region adoption</title></head>'+
  '<body><div id="app">'+h4Response.body+
  '</div><script type="module" src="./h4.js"></script></body></html>');
console.log(JSON.stringify({h4Route,markerId:h4Compiled.hydrationPlan.markerId,
  buildId:h4Manifest.buildId,htmlBytes:h4Response.body.length}));
