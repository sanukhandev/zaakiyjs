import {performance} from "node:perf_hooks";
import {join,resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {createRequire} from "node:module";
import {writeFile,mkdir} from "node:fs/promises";

const root=resolve(process.argv[2]??".");
const outfile=resolve(process.argv[3]??"benchmark-artifacts/roving.json");
const require=createRequire(pathToFileURL(join(root,"packages/ui-primitives/package.json")).href);
const {JSDOM}=require("jsdom");
const dom=new JSDOM("<!doctype html><html><body></body></html>",{pretendToBeVisual:true});
const win=dom.window;
Object.assign(globalThis,{
 window:win,document:win.document,Node:win.Node,
 Element:win.Element,HTMLElement:win.HTMLElement,
 HTMLButtonElement:win.HTMLButtonElement,KeyboardEvent:win.KeyboardEvent,
 NodeFilter:win.NodeFilter
});
const {createOwner,disposeOwner}=await import(pathToFileURL(join(root,"packages/core/dist/index.js")).href);
const {createRovingFocus}=await import(pathToFileURL(join(root,"packages/ui-primitives/dist/index.js")).href);
const percentile=(samples,f)=>{
 const sorted=[...samples].sort((a,b)=>a-b),p=(sorted.length-1)*f,lo=Math.floor(p),hi=Math.ceil(p);
 return sorted[lo]+(sorted[hi]-sorted[lo])*(p-lo);
};
const scenarios=[];
try{
 for(const count of [20,80,160]){
  const container=win.document.createElement("nav");
  const buttons=[];
  for(let n=0;n<count;n++){
   const button=win.document.createElement("button");
   button.id="item-"+n;
   button.textContent="Item "+n;
   container.append(button);
   buttons.push(button);
  }
  win.document.body.append(container);
  const createMs=[],disposeMs=[];
  try{
   for(let k=-1;k<10;k++){
    const owner=createOwner();
    const start=performance.now();
    const control=createRovingFocus({
      owner,container,items:()=>buttons,initialId:"item-0"
    });
    const elapsed=performance.now()-start;
    if(control.activeId!=="item-0"||buttons[0].tabIndex!==0||
       buttons.slice(1).some(item=>item.tabIndex!==-1))
      throw Error("Incorrect roving tabindex/initial item");
    const teardown=performance.now();
    disposeOwner(owner);
    const after=performance.now()-teardown;
    if(control.activeId!==null||buttons.some(item=>item.hasAttribute("tabindex")))
      throw Error("Roving scope leaked tabindex attributes");
    if(k>=0){createMs.push(elapsed);disposeMs.push(after);}
   }
  } finally{container.remove();}
  const value={count,warmups:1,samples:10,
    create:{p50_ms:percentile(createMs,.5),p95_ms:percentile(createMs,.95),samples_ms:createMs},
    dispose:{p50_ms:percentile(disposeMs,.5),p95_ms:percentile(disposeMs,.95),samples_ms:disposeMs}};
  scenarios.push(value);
  console.log("roving",count,"initial create",value.create.p50_ms.toFixed(2),
    "cleanup",value.dispose.p50_ms.toFixed(2),"ms");
 }
}finally{win.close();}
await mkdir(resolve(outfile,".."),{recursive:true});
await writeFile(outfile,JSON.stringify({schemaVersion:1,node:process.version,
 method:"jsdom 26 DOM roving initial registration + owner teardown; 10 samples, same item IDs, stable tabindex and complete cleanup",scenarios},null,2)+"\n");
