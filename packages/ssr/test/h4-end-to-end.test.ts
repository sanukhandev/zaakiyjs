// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { compileRegionServer } from "@zaakiyjs/compiler";
import { signal, flushSync } from "@zaakiyjs/signals";
import { hydrateRegionPage } from "../src/hydrate-region.js";
import type { HydrationEnvelopeV1, TrustedServerBuildManifestV1 } from "../src/protocol.js";

const fileName="packages/ssr/test/h4-page.tsx";
const routeId="product";
const source=[
  "function Badge(props:{title:string}) { return <span>{props.title}</span>; }",
  "function Card(props:{title:string}) { return <article><Badge title={props.title}/></article>; }",
  "function Page(props:{title:string;shown:boolean;rows:{id:string;label:string}[]}) {",
  " return <main><input value=\"start\"/><Card title={props.title}/>",
  " {props.shown ? <h2>Shown</h2> : <p>Hidden</p>}",
  " {props.rows.map(item => <button key={item.id}>{item.label}</button>)}</main>;",
  "}"
].join("\n");

describe("H4 compiler -> SSR module -> browser adopted reactive DOM",()=>{
  it("keeps the explicit large-list budget during reactive keyed reconciliation",async()=>{
    const listSource='function Page(props:{rows:{id:string;label:string}[]}){return <main>{props.rows.map(item=><div key={item.id}>{item.label}</div>)}</main>;}';
    const built=compileRegionServer({fileName,routeId,source:listSource,hydrationScale:"large"});
    expect(built.diagnostics.filter(x=>x.severity==="error")).toEqual([]);
    expect(built.hydrationPlan?.limits?.maxRows).toBe(10000);
    const server=await import("data:text/javascript;base64,"+
      Buffer.from(built.js[0]!.code).toString("base64"));
    const rows=(n:number)=>Array.from({length:n},(_,i)=>({id:"r"+i,label:"Row "+i}));
    const state=signal({rows:rows(2)});
    const container=document.createElement("div");
    container.innerHTML=server.render({
      schema:"zaakiy.render/1",route:{id:routeId},
      request:{signal:{aborted:false}},loaderData:state.value
    }).body;
    document.body.append(container);
    const plan=built.hydrationPlan!;
    const manifest:TrustedServerBuildManifestV1={
      schema:"zaakiy.render-manifest/1",buildId:"a".repeat(64),
      irVersion:1,domAbiVersion:1,
      routes:{product:{routeId,moduleId:"compiled",sourceDigest:"f".repeat(64)}}
    };
    const envelope:HydrationEnvelopeV1={
      schema:"zaakiy.hydration/1",buildId:manifest.buildId,routeId,
      domAbiVersion:1,payload:null,
      boundaries:[{markerId:plan.markerId,templateDigest:plan.templateDigest}]
    };
    const handle=hydrateRegionPage(container,plan,envelope,manifest,routeId,{
      read:path=>state.value[path[0] as keyof typeof state.value]
    });
    flushSync(()=>{state.value={rows:rows(4097)};});
    expect(container.querySelectorAll("main > div")).toHaveLength(4097);
    expect(container.querySelector("main > div:last-child")?.textContent).toBe("Row 4096");
    handle.dispose();
    container.remove();
  });

  it("hydrates nested keyed lists with duplicate child keys across distinct parent owners",async()=>{
    const nestedSource=[
      'function Page(props:{groups:{id:string;label:string;items:{id:string;name:string}[]}[]}){',
      'return <main>{props.groups.map(group=><section key={group.id}>',
      '<h2>{group.label}</h2>',
      '{group.items.map(item=><button key={item.id}>{item.name}</button>)}',
      '</section>)}</main>;}'
    ].join("\n");
    const built=compileRegionServer({fileName,routeId,source:nestedSource});
    expect(built.diagnostics.filter(d=>d.severity==="error")).toEqual([]);
    const mod=await import("data:text/javascript;base64,"+
      Buffer.from(built.js[0]!.code).toString("base64"));
    const state=signal({groups:[
      {id:"a",label:"A",items:[{id:"same",name:"First"},{id:"other",name:"Second"}]},
      {id:"b",label:"B",items:[{id:"same",name:"Third"}]}
    ]});
    const html:string=mod.render({
      schema:"zaakiy.render/1",route:{id:routeId},
      request:{signal:{aborted:false}},loaderData:state.value
    }).body;
    const container=document.createElement("div");
    container.innerHTML=html;document.body.append(container);
    const manifest:TrustedServerBuildManifestV1={
      schema:"zaakiy.render-manifest/1",buildId:"a".repeat(64),
      irVersion:1,domAbiVersion:1,
      routes:{product:{routeId,moduleId:"compiled",sourceDigest:"f".repeat(64)}}
    };
    const envelope:HydrationEnvelopeV1={
      schema:"zaakiy.hydration/1",buildId:manifest.buildId,routeId,
      domAbiVersion:1,boundaries:[{markerId:built.hydrationPlan!.markerId,
        templateDigest:built.hydrationPlan!.templateDigest}],payload:null
    };
    const handle=hydrateRegionPage(container,built.hydrationPlan!,envelope,manifest,routeId,{
      read:path=>state.value[path[0] as keyof typeof state.value]
    });
    const original=[...container.querySelectorAll("button")];
    original[2]!.focus();
    flushSync(()=>{state.value={groups:[
      {id:"b",label:"B changed",items:[{id:"same",name:"Third changed"}]},
      {id:"a",label:"A",items:[{id:"other",name:"Second"},{id:"same",name:"First"}]}
    ]};});
    expect([...container.querySelectorAll("button")]).toEqual([
      original[2],original[1],original[0]
    ]);
    expect(container.querySelectorAll("section")[0]?.querySelector("h2")?.textContent).toBe("B changed");
    expect(container.querySelectorAll("button")[0]?.textContent).toBe("Third changed");
    expect(document.activeElement).toBe(original[2]);
    handle.dispose();
    container.remove();
  });

  it("recreates nested conditional owners after outer branch switches, without leaking old nodes",async()=>{
    const nestedSource=[
      "function Page(props:{outer:boolean;inner:boolean;title:string}){",
      "return <main>{props.outer ? <section>{props.inner ? <strong>{props.title}</strong> : <em>Off</em>}</section> : <p>Closed</p>}</main>;",
      "}"
    ].join("\n");
    const built=compileRegionServer({fileName,routeId,source:nestedSource});
    expect(built.diagnostics.filter(d=>d.severity==="error")).toEqual([]);
    const plan=built.hydrationPlan!;
    const rendered=await import("data:text/javascript;base64,"+
      Buffer.from(built.js[0]!.code).toString("base64"));
    const state=signal({outer:true,inner:true,title:"Initial"});
    const html:string=rendered.render({
      schema:"zaakiy.render/1",route:{id:routeId},
      request:{signal:{aborted:false}},loaderData:state.value
    }).body;
    const container=document.createElement("div");
    container.innerHTML=html;document.body.appendChild(container);
    const manifest:TrustedServerBuildManifestV1={
      schema:"zaakiy.render-manifest/1",buildId:"a".repeat(64),
      irVersion:1,domAbiVersion:1,
      routes:{product:{routeId,moduleId:"compiled",sourceDigest:"f".repeat(64)}}
    };
    const envelope:HydrationEnvelopeV1={
      schema:"zaakiy.hydration/1",buildId:manifest.buildId,routeId,
      domAbiVersion:1,boundaries:[{markerId:plan.markerId,
        templateDigest:plan.templateDigest}],payload:null
    };
    const handle=hydrateRegionPage(container,plan,envelope,manifest,routeId,{
      read:path=>state.value[path[0] as keyof typeof state.value]
    });
    const original=container.querySelector("strong");
    expect(original?.textContent).toBe("Initial");
    flushSync(()=>{state.value={...state.value,outer:false};});
    expect(container.querySelector("p")?.textContent).toBe("Closed");
    expect(original?.isConnected).toBe(false);
    flushSync(()=>{state.value={...state.value,inner:false,outer:true};});
    expect(container.querySelector("em")?.textContent).toBe("Off");
    flushSync(()=>{state.value={...state.value,inner:true,title:"Reopened"};});
    expect(container.querySelector("strong")?.textContent).toBe("Reopened");
    expect(container.querySelectorAll("section")).toHaveLength(1);
    handle.dispose();
    container.remove();
  });

  it("preserves server identity/focus and precisely updates component, conditional and keyed regions",async()=>{
    const built=compileRegionServer({fileName,routeId,source});
    expect(built.diagnostics.filter(item=>item.severity==="error")).toEqual([]);
    expect(built.js).toHaveLength(1);
    const plan=built.hydrationPlan!;
    const code=built.js[0]!.code;
    const module=await import("data:text/javascript;base64,"+
      Buffer.from(code).toString("base64"));
    const initial={title:"Name <safe>",shown:true,
      rows:[{id:"a",label:"Alpha"},{id:"b",label:"Beta"}]};
    const props=signal(initial);
    const html:string=module.render({
      schema:"zaakiy.render/1",route:{id:routeId},
      request:{signal:{aborted:false}},loaderData:initial
    }).body;
    expect(html).toContain("Name &lt;safe&gt;");
    const container=document.createElement("section");
    container.innerHTML=html;
    document.body.append(container);
    const root=container.querySelector("main")!;
    const input=container.querySelector("input")!;
    const badge=container.querySelector("span")!;
    const buttons=[...container.querySelectorAll("button")];
    input.value="unsaved draft";
    input.focus();
    const envelope:HydrationEnvelopeV1={
      schema:"zaakiy.hydration/1",domAbiVersion:1,
      buildId:"a".repeat(64),routeId,payload:null,
      boundaries:[{markerId:plan.markerId,templateDigest:plan.templateDigest}]
    };
    const manifest:TrustedServerBuildManifestV1={
      schema:"zaakiy.render-manifest/1",domAbiVersion:1,irVersion:1,
      buildId:envelope.buildId,
      routes:{product:{routeId,moduleId:"compiled/product",sourceDigest:"f".repeat(64)}}
    };
    const handle=hydrateRegionPage(container,plan,envelope,manifest,routeId,{
      read:path=>props.value[path[0] as keyof typeof initial]
    });
    expect(handle.root).toBe(root);
    expect(container.querySelector("span")).toBe(badge);
    expect(input.value).toBe("unsaved draft");
    expect(document.activeElement).toBe(input);
    flushSync(()=>{props.value={...props.value,title:"Updated"};});
    expect(badge.textContent).toBe("Updated");
    expect(container.querySelector("span")).toBe(badge);
    flushSync(()=>{props.value={...props.value,
      rows:[props.value.rows[1]!,props.value.rows[0]!],shown:false};});
    expect(container.querySelectorAll("button")[0]).toBe(buttons[1]);
    expect(container.querySelectorAll("button")[1]).toBe(buttons[0]);
    expect(container.querySelector("p")?.textContent).toBe("Hidden");
    expect(input.value).toBe("unsaved draft");
    handle.dispose();
    const again=hydrateRegionPage(container,plan,envelope,manifest,routeId,{
      read:path=>props.value[path[0] as keyof typeof initial]
    });
    again.dispose();
    container.remove();
  });
});
