// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { createOwner, disposeOwner, initializeOwnedComponent, mountOwner, onCleanup } from "@zaakiyjs/core";
import { flushSync, signal } from "@zaakiyjs/signals";
import { bindConditionalRegion, bindKeyedRegion } from "../src/regions.js";

describe("H4 adopted native DOM region reconciliation", () => {
  it("preserves initial SSR conditional nodes then switches only its bounded branch", () => {
    const parent = document.createElement("main");
    const start = document.createComment("zaakiy-r2:start");
    const end = document.createComment("zaakiy-r2:end");
    const outside = document.createElement("input");
    const branch = document.createElement("strong");
    branch.textContent = "visible";
    parent.append(outside,start,branch,end);
    const shown = signal(true);
    const root = createOwner();
    let cleanups = 0;
    initializeOwnedComponent(root, () => {
      bindConditionalRegion(root, {parent,start,end}, () => shown.value,
        child => {
          const next = document.createElement("em");
          next.textContent = "new true";
          return next;
        }, child => {
          const alternate = document.createElement("p");
          alternate.textContent = "hidden";
          return alternate;
        }, {
          initialBranch:true, preserveMarkupOnDispose:true,
          adopt: () => {onCleanup(() => { cleanups++; });}
        });
    });
    const html = parent.innerHTML;
    mountOwner(root);
    expect(parent.innerHTML).toBe(html);
    expect(branch.parentNode).toBe(parent);
    flushSync(() => {shown.value=false;});
    expect(branch.parentNode).toBeNull();
    expect(parent.querySelector("p")?.textContent).toBe("hidden");
    expect(parent.firstChild).toBe(outside);
    expect(cleanups).toBe(1);
    disposeOwner(root);
    expect(parent.querySelector("p")?.textContent).toBe("hidden");
  });
  it("adopts keyed rows without initial movement and retains row input focus on reorder", () => {
    const parent = document.createElement("section");
    document.body.append(parent);
    const start = document.createComment("zaakiy-r2:region:start");
    const end = document.createComment("zaakiy-r2:region:end");
    const aStart = document.createComment("zaakiy-k2:a:start");
    const aEnd = document.createComment("zaakiy-k2:a:end");
    const bStart = document.createComment("zaakiy-k2:b:start");
    const bEnd = document.createComment("zaakiy-k2:b:end");
    const a = document.createElement("input"), b = document.createElement("input");
    a.value = "A"; b.value = "B";
    parent.append(start,aStart,a,aEnd,bStart,b,bEnd,end);
    const rows = signal([{id:"a",label:"A"},{id:"b",label:"B"}]);
    const root = createOwner();
    const original = [...parent.childNodes];
    let released = 0;
    initializeOwnedComponent(root, () => {
      bindKeyedRegion(root,{parent,start,end},()=>rows.value,item=>item.id,
        item => {
          const next = document.createElement("input");
          next.value=item.label;
          return {node:next,update(updated) {next.value=updated.label;}};
        },
        {initial:[
          {key:"a",item:rows.value[0]!,start:aStart,end:aEnd,
            adopt:(_item,owner) => {onCleanup(()=>{released++;});return {node:a,update(next){a.value=next.label;}};}},
          {key:"b",item:rows.value[1]!,start:bStart,end:bEnd,
            adopt:(_item,owner) => {onCleanup(()=>{released++;});return {node:b,update(next){b.value=next.label;}};}}
        ],preserveMarkupOnDispose:true});
    });
    mountOwner(root);
    expect([...parent.childNodes]).toEqual(original);
    b.focus(); b.setSelectionRange(1,1);
    flushSync(() => { rows.value = [rows.value[1]!,rows.value[0]!]; });
    expect(parent.querySelectorAll("input")[0]).toBe(b);
    expect(parent.querySelectorAll("input")[1]).toBe(a);
    expect(document.activeElement).toBe(b);
    expect(b.selectionStart).toBe(1);
    expect(released).toBe(0);
    disposeOwner(root);
    expect(released).toBe(2);
    expect(parent.querySelectorAll("input")[0]).toBe(b);
    parent.remove();
  });
});
