import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { compileRegionServer } from "../src/server-region.js";

const fileName = "packages/compiler/test/h4-region-example.tsx";
function build(source: string) {
  return compileRegionServer({ fileName, routeId: "products", source });
}
describe("H4 compiler-backed region SSR target", () => {
  it("emits deterministic conditional regions and data slot markers", () => {
    const source = "function Page(props: { active: boolean; name: string }) { return <main>{props.active ? <strong>{props.name}</strong> : <em>hidden</em>}</main>; }";
    const result = build(source);
    expect(result.diagnostics.filter(d => d.severity === "error")).toEqual([]);
    expect(result.js).toHaveLength(1);
    expect(result.hydrationPlan?.schema).toBe("zaakiy.region-hydration/2");
    expect(result.js[0]?.code).toContain("zaakiy-r2:");
    expect(result.js[0]?.code).toContain("zaakiy-d2:");
    expect(build(source).hydrationPlan).toEqual(result.hydrationPlan);
  });
  it("compiles keyed region identity with stable own-property keys", () => {
    const source = "function Page(props: { rows: { id: string; label: string }[] }) { return <main>{props.rows.map(item => <p key={item.id}>{item.label}</p>)}</main>; }";
    const result = build(source);
    expect(result.diagnostics.filter(d => d.severity === "error")).toEqual([]);
    expect(result.hydrationPlan?.nodes).toHaveLength(1);
    expect(result.js[0]?.code).toContain("zaakiy-k2:");
  });
  it("runs reviewed emitted SSR JS with keyed and conditional markers and escaped text", async () => {
    const source = "function Page(props: { show:boolean; title:string; rows:{id:string;label:string}[] }) { return <main>{props.show ? <h2>{props.title}</h2> : <p>Hidden</p>}{props.rows.map(item => <button key={item.id}>{item.label}</button>)}</main>; }";
    const compiled = build(source);
    expect(compiled.diagnostics.filter(d => d.severity === "error")).toEqual([]);
    const code = compiled.js[0]!.code;
    const module = await import("data:text/javascript;base64," + Buffer.from(code).toString("base64"));
    const context = (loaderData: unknown) => ({
      schema: "zaakiy.render/1", route: {id: "products"},
      request: {signal: {aborted: false}}, loaderData
    });
    const result = module.render(context({
      show:true, title:"<script>alert(1)</script>",
      rows:[{id:"a",label:"A&B"},{id:"b",label:"Beta"}]
    }));
    expect(result.body).toContain("&lt;script&gt;");
    expect(result.body).not.toContain("<script>");
    expect(result.body).toContain("zaakiy-r2:");
    expect(result.body).toContain("zaakiy-k2:");
    expect(result.body).toContain("zaakiy-d2:");
    expect(result.body).toContain("A&amp;B");
    expect(() => module.render(context({show:true,title:"ok",
      rows:[{id:"dup",label:"one"},{id:"dup",label:"two"}]}))).toThrow();
    const unsafe = {show:true,rows:[]};
    Object.defineProperty(unsafe,"title",{enumerable:true,get(){throw Error("unsafe");}});
    expect(() => module.render(context(unsafe))).toThrow(/getter forbidden/);
  });
  it("compiles pure local nested TSX components through owner-boundary plans", async () => {
    const source = [
      "function Badge(props:{title:string}) { return <span>{props.title}</span>; }",
      "function Card(props:{title:string}) { return <article><Badge title={props.title} /></article>; }",
      "function Page(props:{title:string}) { return <main><Card title={props.title} /></main>; }"
    ].join("\n");
    const result = build(source);
    expect(result.diagnostics.filter(d => d.severity === "error")).toEqual([]);
    expect(result.js).toHaveLength(1);
    expect(result.hydrationPlan?.nodes[0]?.kind).toBe("element");
    const module = await import("data:text/javascript;base64," +
      Buffer.from(result.js[0]!.code).toString("base64"));
    const html: string = module.render({
      schema:"zaakiy.render/1",route:{id:"products"},
      request:{signal:{aborted:false}},loaderData:{title:"Safe <title>"}
    }).body;
    expect(html).toContain("Safe &lt;title&gt;");
    expect((html.match(/zaakiy-r2:/g)??[]).length).toBe(4);
    expect(build(source).hydrationPlan).toEqual(result.hydrationPlan);
  });
  it("emits declarative JSX event references without executing handler source", () => {
    const source = "function Page(props:{onPress:(event:MouseEvent)=>void}){return <main><button onClick={props.onPress}>Save</button></main>;}";
    const result = build(source);
    expect(result.diagnostics.filter(d=>d.severity==="error")).toEqual([]);
    const root = result.hydrationPlan?.nodes[0];
    expect(root?.kind).toBe("element");
    if (root?.kind !== "element") throw Error("Expected native root");
    const button = root.children[0];
    expect(button?.kind).toBe("element");
    if (button?.kind !== "element") throw Error("Expected native event target");
    expect(button.events).toEqual([{name:"click",path:["onPress"]}]);
    expect(result.js[0]?.code).not.toContain("props.onPress");
  });
  it("rejects inline closures in server JSX event expressions", () => {
    const source = "function Page(){return <main><button onClick={() => console.log('unsafe')}>Save</button></main>;}";
    const result = build(source);
    expect(result.js).toHaveLength(0);
    expect(result.diagnostics.some(d=>d.severity==="error")).toBe(true);
  });
  it("resolves SHA-256-pinned named module imports without executing module source",async()=>{
    const moduleSource=readFileSync(new URL("./h4-widget.tsx",import.meta.url),"utf8");
    const digest=createHash("sha256").update(moduleSource).digest("hex");
    const result=compileRegionServer({
      fileName,routeId:"products",
      source:'import { Widget } from "./h4-widget.js"; function Page(props:{title:string}){return <main><Widget title={props.title}/></main>;}',
      componentModules:[{
        specifier:"./h4-widget.js",
        fileName:"packages/compiler/test/h4-widget.tsx",
        source:moduleSource,digest
      }]
    });
    expect(result.diagnostics.filter(d=>d.severity==="error")).toEqual([]);
    const module=await import("data:text/javascript;base64,"+
      Buffer.from(result.js[0]!.code).toString("base64"));
    const html:string=module.render({
      schema:"zaakiy.render/1",route:{id:"products"},
      request:{signal:{aborted:false}},loaderData:{title:"Trusted"}
    }).body;
    expect(html).toContain("<span>");
    expect(html).toContain("Trusted");
    const tampered=compileRegionServer({
      fileName,routeId:"products",
      source:'import { Widget } from "./h4-widget.js"; function Page(props:{title:string}){return <main><Widget title={props.title}/></main>;}',
      componentModules:[{
        specifier:"./h4-widget.js",
        fileName:"packages/compiler/test/h4-widget.tsx",
        source:moduleSource+" ",digest
      }]
    });
    expect(tampered.js).toHaveLength(0);
  });
  it("lowers named/default slots into component ownership without browser JSX evaluation",async()=>{
    const source=[
      'function Panel(props:{title:string}){return <article><Slot name="header"/><div><Slot name="children"/></div></article>;}',
      'function Page(props:{title:string}){return <main><Panel header={<h2>{props.title}</h2>}><p>Body</p></Panel></main>;}'
    ].join("\n");
    const result=compileRegionServer({fileName,routeId:"products",source,componentSlots:true});
    expect(result.diagnostics.filter(d=>d.severity==="error")).toEqual([]);
    expect(result.js).toHaveLength(1);
    const mod=await import("data:text/javascript;base64,"+
      Buffer.from(result.js[0]!.code).toString("base64"));
    const html:string=mod.render({
      schema:"zaakiy.render/1",route:{id:"products"},
      request:{signal:{aborted:false}},loaderData:{title:"Slot text"}
    }).body;
    expect(html).toContain("<h2>");
    expect(html).toContain("Slot text");
    expect(html).toContain("<p>Body</p>");
    expect(html).not.toContain("<Slot");
  });
  it("rejects unresolved slot outlets rather than rendering an empty fallback",()=>{
    const source=[
      'function Panel(){return <article><Slot name="header"/></article>;}',
      'function Page(){return <main><Panel/></main>;}'
    ].join("\n");
    const result=compileRegionServer({fileName,routeId:"products",source,componentSlots:true});
    expect(result.js).toHaveLength(0);
    expect(result.diagnostics.some(d=>d.severity==="error")).toBe(true);
  });
  it("rejects unsafe dynamic expressions and arbitrary JSX components", () => {
    const sources = [
      "function Page(props:{name:string}) { return <main>{props.name.toUpperCase()}</main>; }",
      "function Page(props:{name:string}) { return <main>{props.name + '!'}</main>; }",
      "function Card(){const secret=Date.now();return <p>card</p>;} function Page(){return <main><Card /></main>;}",
      "function Page(props:{name:string}) { return <main><a href={props.name}>unsafe</a></main>; }"
    ];
    for (const source of sources) {
      const result = build(source);
      expect(result.js, source).toHaveLength(0);
      expect(result.diagnostics.some(d => d.severity === "error"), source).toBe(true);
    }
  });
});
