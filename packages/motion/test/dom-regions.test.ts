// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createOwner, disposeOwner } from "@zaakiyjs/core";
import { signal, flushSync } from "@zaakiyjs/signals";
import { createRegion } from "@zaakiyjs/dom/compiler";
import { bindMotionConditionalRegion } from "../src/dom-regions.js";

afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();document.body.replaceChildren();});

async function flushExitSettlements() {
  // WAAPI -> Motion handle -> bridge finally -> DOM region settle are distinct
  // promise turns. Drain those deterministically without wall-clock sleeping.
  for (let i=0;i<10;i++) await Promise.resolve();
}

function fixture() {
  const owner=createOwner();
  const host=document.createElement("section");
  document.body.append(host);
  const region=createRegion(host);
  const shown=signal(true);
  let creations=0;
  const create=()=>{creations++;const button=document.createElement("button");button.textContent="Go";return button;};
  return {owner,host,region,shown,create,get creations(){return creations;}};
}
const exit={
  keyframes:[{opacity:1},{opacity:0}],
  duration:100,
  reducedMotion:"force" as const
};

describe("opt-in Motion native conditional DOM adapter",()=>{
  it("retains exiting native element and owner until WAAPI completes",async()=>{
    const f=fixture();
    let resolve!:()=>void;
    const finished=new Promise<void>(ok=>{resolve=ok;});
    const cancel=vi.fn();
    const animate=vi.fn(()=>({finished,cancel,finish:vi.fn(),pause:vi.fn(),play:vi.fn()}));
    const descriptor=Object.getOwnPropertyDescriptor(Element.prototype,"animate");
    Object.defineProperty(Element.prototype,"animate",{configurable:true,value:animate});
    try {
      const binding=bindMotionConditionalRegion(f.owner,f.region,()=>f.shown.value,f.create,{exit,maxExitMs:1000});
      const button=f.host.querySelector("button")!;
      expect(button).toBeTruthy();
      f.shown.value=false;
      flushSync();
      expect(f.host.querySelector("button")).toBe(button);
      expect(animate).toHaveBeenCalledOnce();
      resolve();
      await flushExitSettlements();
      expect(f.host.querySelector("button")).toBeNull();
      expect(cancel).toHaveBeenCalled();
      binding.dispose();
      disposeOwner(f.owner);
    }finally{
      if(descriptor)Object.defineProperty(Element.prototype,"animate",descriptor);
      else Reflect.deleteProperty(Element.prototype,"animate");
    }
  });

  it("cancels stale exit without replacing native input or losing focus on immediate reentry",async()=>{
    const f=fixture();
    let resolve!:()=>void;
    const finished=new Promise<void>(ok=>{resolve=ok;});
    const cancel=vi.fn();
    const descriptor=Object.getOwnPropertyDescriptor(Element.prototype,"animate");
    Object.defineProperty(Element.prototype,"animate",{configurable:true,
      value:vi.fn(()=>({finished,cancel,finish:vi.fn(),pause:vi.fn(),play:vi.fn()}))});
    try {
      const binding=bindMotionConditionalRegion(f.owner,f.region,()=>f.shown.value,f.create,{exit,maxExitMs:1000});
      const button=f.host.querySelector("button")!;
      button.focus();
      f.shown.value=false;flushSync();
      expect(f.host.querySelector("button")).toBe(button);
      f.shown.value=true;flushSync();
      expect(f.host.querySelector("button")).toBe(button);
      expect(document.activeElement).toBe(button);
      expect(f.creations).toBe(1);
      expect(cancel).toHaveBeenCalledOnce();
      resolve();
      await flushExitSettlements();
      expect(f.host.querySelector("button")).toBe(button);
      binding.dispose();
      disposeOwner(f.owner);
    }finally{
      if(descriptor)Object.defineProperty(Element.prototype,"animate",descriptor);
      else Reflect.deleteProperty(Element.prototype,"animate");
    }
  });

  it("fails closed on animation lifetime overflow without retaining DOM owners",()=>{
    const f=fixture();
    expect(()=>bindMotionConditionalRegion(f.owner,f.region,()=>f.shown.value,f.create,{
      exit:{...exit,duration:10_000},maxExitMs:100
    })).toThrow("bounded DOM owner lifetime");
    expect(f.host.querySelector("button")).toBeNull();
    disposeOwner(f.owner);
  });

  it("supports reduced-motion fallback and disposes on parent unmount",async()=>{
    const f=fixture();
    const binding=bindMotionConditionalRegion(f.owner,f.region,()=>f.shown.value,f.create,{
      exit:{keyframes:[{opacity:1},{opacity:0}],duration:0},
      maxExitMs:100
    });
    expect(f.host.querySelector("button")).not.toBeNull();
    f.shown.value=false;flushSync();
    await flushExitSettlements();
    expect(f.host.querySelector("button")).toBeNull();
    binding.dispose();
    disposeOwner(f.owner);
  });
});
