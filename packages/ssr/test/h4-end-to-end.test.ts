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
