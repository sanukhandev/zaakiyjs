// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { flushSync, signal } from "@zaakiyjs/signals";
import { createHydrationTransitionCoordinator } from "../src/hydration-transitions.js";
import { hydrateRegionRoute, hydrateRegionRouteWithState } from "../src/hydration-route.js";
import { serializeHydrationState } from "../src/hydration-state.js";
import type { JsonHydrationValue } from "../src/hydration-state.js";
import type { RegionHydrationPlanV2 } from "../src/hydrate-region.js";
import type { HydrationEnvelopeV1, TrustedServerBuildManifestV1 } from "../src/protocol.js";

const buildId="a".repeat(64), routeId="products", markerId="b".repeat(32),
  digest="c".repeat(64), rootId="d".repeat(32), textId="e".repeat(32);
const plan:RegionHydrationPlanV2={
  schema:"zaakiy.region-hydration/2",routeId,markerId,templateDigest:digest,
  nodes:[{kind:"element",id:rootId,tag:"button",attrs:[],children:[
    {kind:"data",id:textId,source:"props",path:["name"]}
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
function fixture() {
  const root=document.createElement("section");
  root.innerHTML=`<!--zaakiy-h:${markerId}:${digest}--><button><!--zaakiy-d2:${textId}:start-->Amina<!--zaakiy-d2:${textId}:end--></button>`;
  return root;
}

describe("H5 region hydration route transaction integration",()=>{
  it("refuses stale/superseded route work before listener ownership or DOM mutation",()=>{
    const manager=createHydrationTransitionCoordinator();
    const root=fixture(),button=root.querySelector("button")!;
    const html=root.innerHTML;
    const stale=manager.start(routeId);
    const active=manager.start(routeId);
    let clicks=0;
    const bindings={
      read:()=> "Amina",
      events:[{elementId:rootId,name:"click",handler:()=>{clicks++;}}]
    };
    expect(()=>hydrateRegionRoute(root,plan,envelope,manifest,stale,bindings)).toThrow();
    expect(root.innerHTML).toBe(html);
    button.click();expect(clicks).toBe(0);
    const handle=hydrateRegionRoute(root,plan,envelope,manifest,active,bindings);
    expect(handle.root).toBe(button);
    expect(root.innerHTML).toBe(html);
    button.click();expect(clicks).toBe(1);
    manager.start("other");
    button.click();expect(clicks).toBe(1);
    expect(root.innerHTML).toBe(html);
    handle.dispose();
    manager.dispose();
  });

  it("restores approved state only on current route and disposes it exactly once on navigation abort",()=>{
    const manager=createHydrationTransitionCoordinator();
    const root=fixture(),button=root.querySelector("button")!;
    const original=button.firstChild;
    const html=root.innerHTML;
    const packet=serializeHydrationState(buildId,routeId,{name:"Amina"});
    const stale=manager.start(routeId);
    const current=manager.start(routeId);
    let initialized=0,cleaned=0;
    let name=signal("not-initialized");
    const initialize=(value:JsonHydrationValue)=>{
      initialized++;
      if(!value||typeof value!=="object"||Array.isArray(value)||
        typeof (value as Record<string,unknown>).name!=="string")throw Error("invalid public state");
      name=signal((value as Record<string,string>).name);
      return {read:()=>name.value,disposeState:()=>{cleaned++;}};
    };
    expect(()=>hydrateRegionRouteWithState(root,plan,envelope,manifest,stale,packet,initialize)).toThrow();
    expect(initialized).toBe(0);
    const handle=hydrateRegionRouteWithState(root,plan,envelope,manifest,current,packet,initialize);
    expect(initialized).toBe(1);
    expect(root.innerHTML).toBe(html);
    expect(handle.root).toBe(button);
    expect(button.firstChild).toBe(original);
    name.value="Updated";
    flushSync();
    expect(button.textContent).toBe("Updated");
    manager.start("other");
    expect(cleaned).toBe(1);
    handle.dispose();handle.dispose();
    expect(cleaned).toBe(1);
    manager.dispose();
  });

  it("rejects invalid route or public-state deployment identity before invoking callbacks",()=>{
    const manager=createHydrationTransitionCoordinator();
    const root=fixture(),before=root.innerHTML;
    const other=manager.start("other");
    const packet=serializeHydrationState(buildId,routeId,{name:"Amina"});
    let initialized=0;
    const init=()=>{initialized++;return {read:()=> "Amina"};};
    expect(()=>hydrateRegionRouteWithState(root,plan,envelope,manifest,other,packet,init)).toThrow(/route mismatch/);
    const active=manager.start(routeId);
    const wrongBuild=serializeHydrationState("0".repeat(64),routeId,{name:"Amina"});
    expect(()=>hydrateRegionRouteWithState(root,plan,envelope,manifest,active,wrongBuild,init)).toThrow();
    expect(initialized).toBe(0);
    expect(root.innerHTML).toBe(before);
    manager.dispose();
  });
});
