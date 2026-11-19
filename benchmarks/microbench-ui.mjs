import {performance} from "node:perf_hooks";
import {join,resolve} from "node:path";
import {createRequire} from "node:module";
import {pathToFileURL} from "node:url";
import {mkdir,writeFile} from "node:fs/promises";
const root=resolve(process.argv[2]??".");
const out=resolve(process.argv[3]??"benchmark-artifacts/ui.json");
const require=createRequire(pathToFileURL(join(root,"packages/ui/package.json")).href);
const {JSDOM}=require("jsdom");
const dom=new JSDOM("<!doctype html><html><body></body></html>");
const win=dom.window;
Object.assign(globalThis,{window:win,document:win.document,Node:win.Node,
 Element:win.Element,HTMLElement:win.HTMLElement,
 HTMLButtonElement:win.HTMLButtonElement,HTMLInputElement:win.HTMLInputElement,
 Event:win.Event,MouseEvent:win.MouseEvent});
const {createOwner,disposeOwner,runWithOwner}=await import(pathToFileURL(join(root,"packages/core/dist/index.js")).href);
const {Button,TextField}=await import(pathToFileURL(join(root,"packages/ui/dist/index.js")).href);
const pct=(x,p)=>{const v=[...x].sort((a,b)=>a-b),n=(v.length-1)*p,l=Math.floor(n),h=Math.ceil(n);return v[l]+(v[h]-v[l])*(n-l);};
const scenarios=[];
try{
 for(const type of ["button","text-field"])for(const count of [50,200]){
  const samples=[];
  for(let run=-3;run<20;run++){
   const owner=createOwner();let presses=0;
   try{
    const started=performance.now();
    const nodes=runWithOwner(owner,()=>Array.from({length:count},(_,i)=>
     type==="button"?
       Button({label:"Save "+i,onPress:()=>{presses++;}}):
       TextField({id:"input-"+i,label:"Name "+i,value:"safe"})
    ));
    const elapsed=(performance.now()-started)/count;
    const first=nodes[0];
    if(type==="button"){
     if(first.tagName!=="BUTTON"||first.textContent!=="Save 0")throw Error("Invalid native Button");
     first.click();
     if(presses!==1)throw Error("Button callback missing");
    } else if(first.tagName!=="DIV"||first.querySelector("input")?.value!=="safe"||
              first.querySelector('label[for="input-0"]')?.textContent!=="Name 0")
      throw Error("Invalid native TextField");
    disposeOwner(owner);
    if(type==="button"){
      first.click();
      if(presses!==1)throw Error("Listener retained after owner disposal");
    }
    if(run>=0)samples.push(elapsed);
   }finally{if(!owner.disposed)disposeOwner(owner);}
  }
  const record={type,count,samples:20,warmups:3,
   p50_ms_per_component:pct(samples,.5),p95_ms_per_component:pct(samples,.95),
   samples_ms_per_component:samples};
  scenarios.push(record);
  console.log("ui",type,count,"p50",record.p50_ms_per_component.toFixed(5),"ms");
 }
}finally{win.close();}
await mkdir(resolve(out,".."),{recursive:true});
await writeFile(out,JSON.stringify({schemaVersion:1,node:process.version,
 method:"Owner-scoped native Button/TextField creation in JSDOM 26; validates native DOM and disposes event listeners, excludes browser layout/paint",scenarios},null,2)+"\n");
