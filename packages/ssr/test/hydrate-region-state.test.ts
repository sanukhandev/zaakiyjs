// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { signal } from "@zaakiyjs/signals";
import { hydrateRegionPageWithState } from "../src/hydrate-region-state.js";
import { serializeHydrationState } from "../src/hydration-state.js";
import type { RegionHydrationPlanV2 } from "../src/hydrate-region.js";
import type { HydrationEnvelopeV1, TrustedServerBuildManifestV1 } from "../src/protocol.js";
const buildId="a".repeat(64),routeId="products",markerId="b".repeat(32),digest="c".repeat(64);
const nodeId="d".repeat(32),slotId="e".repeat(32);
const plan:RegionHydrationPlanV2={
  schema:"zaakiy.region-hydration/2",routeId,markerId,templateDigest:digest,
  nodes:[{kind:"element",id:nodeId,tag:"main",attrs:[],children:[
    {kind:"data",id:slotId,source:"props",path:["name"]}
  ]}]
};
const manifest:TrustedServerBuildManifestV1={
  schema:"zaakiy.render-manifest/1",buildId,irVersion:1,domAbiVersion:1,
  routes:{products:{routeId,moduleId:"compiled",sourceDigest:"f".repeat(64)}}
};
const envelope:HydrationEnvelopeV1={
  schema:"zaakiy.hydration/1",buildId,routeId,domAbiVersion:1,
  boundaries:[{markerId,templateDigest:digest}],payload:null
};
const fixture=()=>{
  const root=document.createElement("section");
  root.innerHTML=`<!--zaakiy-h:${markerId}:${digest}--><main><!--zaakiy-d2:${slotId}:start-->Amina<!--zaakiy-d2:${slotId}:end--></main>`;
  return root;
};
describe("H4 explicit public-state hydration",()=>{
  it("constructs signal-backed initial state without replacing SSR native nodes",()=>{
    const root=fixture();
    const html=root.innerHTML;
    const packet=serializeHydrationState(buildId,routeId,{name:"Amina"});
    let released=0;
    let state:ReturnType<typeof signal<string>>|undefined;
    const handle=hydrateRegionPageWithState(root,plan,envelope,manifest,routeId,
      packet,value=>{
        if(!value || typeof value!=="object" || Array.isArray(value)) throw Error("invalid");
        const name=(value as Record<string,unknown>).name;
        if(typeof name!=="string") throw Error("expected public name");
        state=signal(name);
        return {read:()=>state!.value,disposeState:()=>{released++;}};
      });
    const original=root.lastChild;
    expect(root.innerHTML).toBe(html);
    expect(handle.root).toBe(original);
    handle.dispose();handle.dispose();
    expect(released).toBe(1);
    expect(root.innerHTML).toBe(html);
  });
  it("refuses build mismatches before the app initializer is called",()=>{
    const root=fixture();
    let initializations=0;
    const packet=serializeHydrationState("f".repeat(64),routeId,{name:"Amina"});
    expect(()=>hydrateRegionPageWithState(root,plan,envelope,manifest,routeId,
      packet,()=>{initializations++;return {read:()=>null};})).toThrow();
    expect(initializations).toBe(0);
  });
  it("disposes initialized state if DOM preflight fails",()=>{
    const root=fixture();root.querySelector("main")!.textContent="wrong";
    let disposed=0;
    const packet=serializeHydrationState(buildId,routeId,{name:"Amina"});
    expect(()=>hydrateRegionPageWithState(root,plan,envelope,manifest,routeId,
      packet,()=>({read:()=> "Amina",disposeState:()=>{disposed++;}}))).toThrow();
    expect(disposed).toBe(1);
  });
});
