// @vitest-environment jsdom
import {describe,expect,it,vi} from "vitest";
import {createOwner,disposeOwner} from "@zaakiyjs/core";
import {createRovingFocus} from "../src/index.js";

describe("initial roving registration and disposal batching",()=>{
 it("preserves explicit initial selection, exact DOM order, focus and owner cleanup",()=>{
  const owner=createOwner();
  const container=document.createElement("nav");
  const items=Array.from({length:160},(_,i)=>{
   const button=document.createElement("button");
   button.id="entry-"+i;
   button.textContent=String(i);
   container.append(button);
   return button;
  });
  document.body.append(container);
  const onActiveChange=vi.fn();
  try{
   const roving=createRovingFocus({container,owner,items:()=>items,
     initialId:"entry-95",onActiveChange});
   expect(roving.activeId).toBe("entry-95");
   expect(roving.items().map(item=>item.id)).toEqual(items.map(item=>item.id));
   for(let i=0;i<items.length;i++)
    expect(items[i]!.tabIndex,i+" tabindex").toBe(i===95?0:-1);
   roving.move("entry-159");
   expect(roving.activeId).toBe("entry-159");
   expect(document.activeElement).toBe(items[159]);
   expect(onActiveChange).toHaveBeenCalledOnce();
   const extra=document.createElement("button");
   extra.id="entry-new";
   container.append(extra);
   const registration=roving.register({id:extra.id,element:extra});
   roving.move(extra.id);
   expect(roving.activeId).toBe(extra.id);
   expect(extra.tabIndex).toBe(0);
   registration.dispose();
   expect(extra.hasAttribute("tabindex")).toBe(false);
   expect(roving.activeId).toBe("entry-0");
   disposeOwner(owner);
   expect(roving.activeId).toBeNull();
   expect(items.every(item=>!item.hasAttribute("tabindex"))).toBe(true);
   expect(onActiveChange).toHaveBeenCalledTimes(2);
  } finally {
   if(!owner.disposed)disposeOwner(owner);
   container.remove();
  }
 });
 it("defaults to first connected enabled item and does not retain listeners after cleanup",()=>{
  const owner=createOwner();
  const container=document.createElement("nav");
  container.innerHTML='<button id="bad" disabled>disabled</button><button id="good">enabled</button>';
  document.body.append(container);
  const buttons=[...container.querySelectorAll("button")];
  try{
   const roving=createRovingFocus({container,owner,items:()=>buttons,initialId:"missing"});
   expect(roving.activeId).toBe("good");
   disposeOwner(owner);
   expect(roving.activeId).toBeNull();
   expect(buttons.every(btn=>!btn.hasAttribute("tabindex"))).toBe(true);
  }finally{
   if(!owner.disposed)disposeOwner(owner);
   container.remove();
  }
 });
});
