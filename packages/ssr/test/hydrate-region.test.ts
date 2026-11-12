// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { flushSync, signal } from "@zaakiyjs/signals";
import { hydrateRegionPage } from "../src/hydrate-region.js";
import type { RegionHydrationPlanV2 } from "../src/hydrate-region.js";
import type { HydrationEnvelopeV1, TrustedServerBuildManifestV1 } from "../src/protocol.js";

const buildId = "a".repeat(64), markerId = "b".repeat(32), digest = "c".repeat(64);
const rootId = "d".repeat(32), conditionalId = "e".repeat(32), headerId = "f".repeat(32);
const titleSlot = "1".repeat(32), listId = "2".repeat(32), rowId = "3".repeat(32), rowSlot = "4".repeat(32);
const routeId = "products";
const plan: RegionHydrationPlanV2 = {
  schema: "zaakiy.region-hydration/2", routeId, markerId, templateDigest: digest,
  nodes: [{ kind: "element", id: rootId, tag: "main", attrs: [], children: [
    { kind: "conditional", id: conditionalId, path: ["visible"], yes: [
      { kind: "element", id: headerId, tag: "h2", attrs: [], children: [
        { kind: "data", id: titleSlot, path: ["title"], source: "props" }
      ] }
    ], no: [] },
    { kind: "keyed", id: listId, path: ["rows"], itemName: "item", key: "id", rows: [
      { kind: "element", id: rowId, tag: "button", attrs: [], children: [
        { kind: "data", id: rowSlot, path: ["label"], source: "item" }
      ] }
    ] }
  ] }]
};
const manifest: TrustedServerBuildManifestV1 = {
  schema: "zaakiy.render-manifest/1", buildId, domAbiVersion: 1, irVersion: 1,
  routes: { products: { routeId, moduleId: "module", sourceDigest: "5".repeat(64) } }
};
const envelope: HydrationEnvelopeV1 = {
  schema: "zaakiy.hydration/1", buildId, routeId, domAbiVersion: 1,
  boundaries: [{ markerId, templateDigest: digest }], payload: null
};
function fixture() {
  const container = document.createElement("section");
  container.innerHTML = `<!--zaakiy-h:${markerId}:${digest}--><main><!--zaakiy-r2:${conditionalId}:start--><h2><!--zaakiy-d2:${titleSlot}:start-->Products<!--zaakiy-d2:${titleSlot}:end--></h2><!--zaakiy-r2:${conditionalId}:end--><!--zaakiy-r2:${listId}:start--><!--zaakiy-k2:${listId}:a:start--><button><!--zaakiy-d2:${rowSlot}:start-->Alpha<!--zaakiy-d2:${rowSlot}:end--></button><!--zaakiy-k2:${listId}:a:end--><!--zaakiy-k2:${listId}:b:start--><button><!--zaakiy-d2:${rowSlot}:start-->Beta<!--zaakiy-d2:${rowSlot}:end--></button><!--zaakiy-k2:${listId}:b:end--><!--zaakiy-r2:${listId}:end--></main>`;
  return container;
}
const state = () => ({ visible: true, title: "Products",
  rows: [{id:"a",label:"Alpha"},{id:"b",label:"Beta"}] });
describe("H4 compiler-region client adoption", () => {
  it("adopts keyed/conditional DOM without replacing nodes and disposes keyed listeners", () => {
    const container = fixture();
    document.body.appendChild(container);
    const main = container.lastChild;
    const buttons = [...container.querySelectorAll("button")];
    buttons[1]!.focus();
    let clicks = 0;
    const data = state();
    const html = container.innerHTML;
    const handle = hydrateRegionPage(container, plan, envelope, manifest, routeId, {
      read: path => data[path[0] as keyof typeof data],
      events: [{elementId: rowId + ":b", name: "click", handler: () => { clicks++; }}]
    });
    expect(handle.root).toBe(main);
    expect(container.innerHTML).toBe(html);
    expect(container.querySelectorAll("button")[0]).toBe(buttons[0]);
    expect(document.activeElement).toBe(buttons[1]);
    buttons[1]!.click();
    expect(clicks).toBe(1);
    handle.dispose();
    buttons[1]!.click();
    expect(clicks).toBe(1);
    expect(container.innerHTML).toBe(html);
    container.remove();
  });
  it("reconciles keyed rows and conditional branches without losing retained node identity", () => {
    const container = fixture();
    document.body.appendChild(container);
    const app = signal(state());
    const hydrate = () => hydrateRegionPage(container,plan,envelope,manifest,routeId,{
      read:path => app.value[path[0] as keyof ReturnType<typeof state>]
    });
    const handle = hydrate();
    const originalButtons = [...container.querySelectorAll("button")];
    const header = container.querySelector("h2");
    originalButtons[1]!.focus();
    flushSync(() => {app.value={...app.value,rows:[app.value.rows[1]!,app.value.rows[0]!]};});
    const reordered = [...container.querySelectorAll("button")];
    expect(reordered[0]).toBe(originalButtons[1]);
    expect(reordered[1]).toBe(originalButtons[0]);
    expect(document.activeElement).toBe(originalButtons[1]);
    flushSync(() => {app.value={...app.value,visible:false};});
    expect(header?.parentNode).toBeNull();
    expect(container.querySelectorAll("button")[0]).toBe(originalButtons[1]);
    flushSync(() => {app.value={...app.value,visible:true};});
    expect(container.querySelector("h2")?.textContent).toBe("Products");
    expect(container.querySelectorAll("button")[1]).toBe(originalButtons[0]);
    flushSync(() => {app.value={...app.value,rows:[
      {id:"b",label:"Beta updated"},{id:"c",label:"Gamma"}
    ]};});
    expect(container.querySelector("button")?.textContent).toBe("Beta updated");
    expect(container.querySelectorAll("button")[0]).toBe(originalButtons[1]);
    expect(container.querySelectorAll("button")[1]?.textContent).toBe("Gamma");
    handle.dispose();
    const again=hydrate();
    expect(again.root).toBe(container.lastChild);
    again.dispose();
    container.remove();
  });
  it("hydrates compiler-declared keyed JSX events with stable owner cleanup", () => {
    const container=fixture();
    const rows=state();
    const withEvents:RegionHydrationPlanV2={
      ...plan,
      nodes:plan.nodes.map(root => root.kind==="element" ? {
        ...root,children:root.children.map(child => child.kind==="keyed" ? {
          ...child, rows:child.rows.map(row=>row.kind==="element" ? {
            ...row,events:[{name:"click",path:["onPress"]}]
          }:row)
        }:child)
      }:root)
    };
    let count=0;
    const handles=()=>hydrateRegionPage(container,withEvents,envelope,manifest,routeId,{
      read:path=>rows[path[0] as keyof typeof rows],
      resolveEvent:path=>{
        expect(path).toEqual(["onPress"]);
        return ()=>{count++;};
      }
    });
    const a=container.querySelectorAll("button")[0]!;
    const b=container.querySelectorAll("button")[1]!;
    const first=handles();
    a.click();b.click();
    expect(count).toBe(2);
    first.dispose();
    a.click();b.click();
    expect(count).toBe(2);
    const second=handles();
    b.click();
    expect(count).toBe(3);
    second.dispose();
    expect(container.querySelectorAll("button")[0]).toBe(a);
  });
  it("refuses unresolved compiler JSX events before attaching any owner", () => {
    const container=fixture();
    const withEvents:RegionHydrationPlanV2={
      ...plan,
      nodes:plan.nodes.map(root=>root.kind==="element" ? {
        ...root,events:[{name:"click",path:["onClick"]}]
      }:root)
    };
    const original=container.innerHTML;
    expect(()=>hydrateRegionPage(container,withEvents,envelope,manifest,routeId,{
      read:path=>state()[path[0] as keyof ReturnType<typeof state>]
    })).toThrow(/resolver/);
    expect(container.innerHTML).toBe(original);
  });
  it("aborts before mutation when keyed state disagrees with SSR", () => {
    const container = fixture();
    const html = container.innerHTML;
    const data = state();
    data.rows.reverse();
    expect(() => hydrateRegionPage(container, plan, envelope, manifest, routeId, {
      read: path => data[path[0] as keyof typeof data]
    })).toThrow(/mismatch/);
    expect(container.innerHTML).toBe(html);
  });
  it("refuses missing conditional branch and duplicate SSR row keys", () => {
    const container = fixture();
    const data = state();
    data.visible = false;
    expect(() => hydrateRegionPage(container, plan, envelope, manifest, routeId, {
      read: path => data[path[0] as keyof typeof data]
    })).toThrow(/mismatch/);
    const dup = state();
    dup.rows[1]!.id = "a";
    expect(() => hydrateRegionPage(container, plan, envelope, manifest, routeId, {
      read: path => dup[path[0] as keyof typeof dup]
    })).toThrow(/mismatch/);
  });
  it("rejects forged template marker or stale route before attaching listeners", () => {
    const container = fixture();
    const data = state();
    expect(() => hydrateRegionPage(container, { ...plan, templateDigest:"0".repeat(64) },
      envelope, manifest, routeId,{read:path => data[path[0] as keyof typeof data]})).toThrow();
    const abort = new AbortController();
    abort.abort();
    expect(() => hydrateRegionPage(container, plan, envelope,manifest,routeId,{
      read:path=>data[path[0] as keyof typeof data],signal:abort.signal
    })).toThrow();
  });
});
