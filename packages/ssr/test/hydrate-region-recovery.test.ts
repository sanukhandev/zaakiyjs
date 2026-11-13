// @vitest-environment jsdom
import {describe,expect,it} from "vitest";
import {hydrateRegionPageRecoverBoundary} from "../src/hydrate-region-recovery.js";
import type {RegionHydrationPlanV2} from "../src/hydrate-region.js";
import type {HydrationEnvelopeV1,TrustedServerBuildManifestV1} from "../src/protocol.js";
const buildId="a".repeat(64),markerId="b".repeat(32),digest="c".repeat(64);
const rootId="d".repeat(32),regionId="e".repeat(32),asideId="f".repeat(32);
const branchId="1".repeat(32),routeId="item";
const plan:RegionHydrationPlanV2={
  schema:"zaakiy.region-hydration/2",routeId,markerId,templateDigest:digest,
  nodes:[{kind:"element",id:rootId,tag:"main",attrs:[],children:[
    {kind:"element",id:asideId,tag:"aside",attrs:[],children:[
      {kind:"literal",value:"untouched"}
    ]},
    {kind:"conditional",id:regionId,source:"props",path:["show"],yes:[
      {kind:"element",id:branchId,tag:"strong",attrs:[],children:[
        {kind:"literal",value:"expected"}
      ]}
    ],no:[]}
  ]}]
};
const manifest:TrustedServerBuildManifestV1={
  schema:"zaakiy.render-manifest/1",buildId,irVersion:1,domAbiVersion:1,
  routes:{item:{routeId,moduleId:"compiled/item",sourceDigest:"0".repeat(64)}}
};
const envelope:HydrationEnvelopeV1={
  schema:"zaakiy.hydration/1",buildId,routeId,domAbiVersion:1,
  payload:null,boundaries:[{markerId,templateDigest:digest}]
};
function fixture(){
  const container=document.createElement("div");
  container.innerHTML=`<!--zaakiy-h:${markerId}:${digest}--><main><aside>untouched</aside><!--zaakiy-r2:${regionId}:start--><strong>wrong</strong><!--zaakiy-r2:${regionId}:end--></main>`;
  return container;
}
describe("H4 bounded recovery opt-in",()=>{
  it("swaps only the compiler-owned region and preserves unrelated native identity",()=>{
    const container=fixture();
    const sibling=container.querySelector("aside");
    const originalRoot=container.querySelector("main");
    const handle=hydrateRegionPageRecoverBoundary(container,plan,envelope,manifest,routeId,
      {read:()=>true},{boundaryId:regionId,prepare:()=>{
        const strong=document.createElement("strong");
        strong.textContent="expected";return strong;
      }});
    expect(container.querySelector("aside")).toBe(sibling);
    expect(container.querySelector("main")).toBe(originalRoot);
    expect(container.querySelector("strong")?.textContent).toBe("expected");
    handle.dispose();
  });
  it("rolls back the original DOM if generated native nodes do not match the plan",()=>{
    const container=fixture();
    const before=container.innerHTML;
    const original=container.querySelector("strong");
    expect(()=>hydrateRegionPageRecoverBoundary(container,plan,envelope,manifest,routeId,
      {read:()=>true},{boundaryId:regionId,prepare:()=>document.createElement("em")})).toThrow();
    expect(container.innerHTML).toBe(before);
    expect(container.querySelector("strong")).toBe(original);
  });
  it("fails closed on forged boundary, stale build and pre-aborted navigation",()=>{
    const container=fixture();
    const original=container.innerHTML;
    let factories=0;
    const prepare=()=>{factories++;return document.createElement("strong");};
    expect(()=>hydrateRegionPageRecoverBoundary(container,plan,envelope,manifest,routeId,
      {read:()=>true},{boundaryId:"7".repeat(32),prepare})).toThrow();
    expect(()=>hydrateRegionPageRecoverBoundary(container,plan,envelope,{
      ...manifest,buildId:"9".repeat(64)},routeId,
      {read:()=>true},{boundaryId:regionId,prepare})).toThrow();
    const cancel=new AbortController();cancel.abort();
    expect(()=>hydrateRegionPageRecoverBoundary(container,plan,envelope,manifest,routeId,
      {read:()=>true,signal:cancel.signal},{boundaryId:regionId,prepare})).toThrow();
    expect(factories).toBe(0);
    expect(container.innerHTML).toBe(original);
  });
});
