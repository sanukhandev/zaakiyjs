// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { createOwner, disposeOwner, runWithOwner, mountOwner } from "@zaakiyjs/core";
import { signal, flushSync } from "@zaakiyjs/signals";
import {
  Button, IconButton, LinkButton, ButtonGroup, Textarea, Select, RadioGroup,
  Switch, Container, Stack, Inline, Grid, Flex, AspectRatio, Card,
  Avatar, Skeleton, LoadingIndicator, Pagination, Breadcrumbs,
  SidebarLayout, NavigationMenu, Toast, createToastCenter,
  BoundTextField
} from "../src/index.js";

function scoped<T>(create:()=>T):{owner:ReturnType<typeof createOwner>;value:T}{
  const owner=createOwner();
  return {owner,value:runWithOwner(owner,create)};
}
function el(node:unknown):HTMLElement{return node as HTMLElement;}

describe("P2 native UI component inventory",()=>{
  it("implements frozen Button semantics with native keyboard click and aria label",()=>{
    const handler=vi.fn();
    const {owner,value}=scoped(()=>Button({label:"Save",tone:"danger",appearance:"outline",onPress:handler}));
    const button=el(value) as HTMLButtonElement;
    expect(button.type).toBe("button");
    expect(button.className).toContain("zui-button--danger");
    button.click();
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0]?.[0]?.originalEvent).toBeInstanceOf(MouseEvent);
    disposeOwner(owner);button.click();expect(handler).toHaveBeenCalledTimes(1);
  });
  it("renders icon-only name, link protocol restrictions, and named button groups",()=>{
    const {owner,value}=scoped(()=>IconButton({icon:"×","aria-label":"Close"}));
    expect(el(value).getAttribute("aria-label")).toBe("Close");
    expect(el(value).querySelector('[aria-hidden="true"]')?.textContent).toBe("×");
    const link=runWithOwner(owner,()=>LinkButton({href:"/docs",label:"Documentation",target:"_blank"}));
    expect(el(link).getAttribute("rel")).toContain("noopener");
    expect(()=>runWithOwner(owner,()=>LinkButton({href:"javascript:alert(1)",label:"Unsafe"}))).toThrow();
    const group=runWithOwner(owner,()=>ButtonGroup({label:"Edit actions",buttons:[{label:"Save"},{label:"Cancel"}]}));
    expect(el(group).getAttribute("role")).toBe("group");
    expect(el(group).querySelectorAll("button")).toHaveLength(2);
    disposeOwner(owner);
  });
  it("preserves native values and option semantics for textarea/select",()=>{
    const content=signal("Original");
    const {owner,value}=scoped(()=>Textarea({id:"notes",label:"Notes",value:content}));
    const textarea=el(value).querySelector("textarea")!;
    expect(textarea.value).toBe("Original");
    textarea.value="Changed";textarea.dispatchEvent(new Event("input",{bubbles:true}));
    expect(content.value).toBe("Changed");
    const selector=runWithOwner(owner,()=>Select({
      id:"country",label:"Country",options:[{value:"ae",label:"UAE"},{value:"gb",label:"UK",disabled:true}]
    }));
    expect(el(selector).querySelector("select")?.options).toHaveLength(2);
    expect(el(selector).querySelectorAll("option:disabled")).toHaveLength(1);
    disposeOwner(owner);
  });
  it("uses signals for native radio/switch and controlled pagination without whole subtree replacement",()=>{
    const selected=signal("one");
    const enabled=signal(false);
    const {owner,value}=scoped(()=>RadioGroup({name:"plan",legend:"Plan",value:selected,onValueChange:next=>{selected.value=next;},
      options:[{value:"one",label:"One"},{value:"two",label:"Two"}]}));
    const root=el(value);
    const inputs=root.querySelectorAll<HTMLInputElement>("input");
    expect(inputs[0]?.checked).toBe(true);
    if(!inputs[1])throw Error("no radio");
    inputs[1].checked=true;inputs[1].dispatchEvent(new Event("change",{bubbles:true}));
    flushSync();
    expect(selected.value).toBe("two");
    expect(root.querySelectorAll("input")[1]).toBe(inputs[1]);
    const sw=runWithOwner(owner,()=>Switch({label:"Enable",value:enabled,onValueChange:next=>{enabled.value=next;}}));
    const switchNode=el(sw) as HTMLButtonElement;
    switchNode.click();flushSync();
    expect(enabled.value).toBe(true);
    expect(switchNode.getAttribute("aria-checked")).toBe("true");
    const pages=runWithOwner(owner,()=>Pagination({totalPages:3}));
    const next=el(pages).querySelectorAll("button")[1]!;
    next.click();flushSync();
    expect(el(pages).textContent).toContain("Page 2 of 3");
    disposeOwner(owner);
  });
  it("renders semantics of layouts, display, breadcrumbs and navigation without unsafe HTML parsing",()=>{
    const {owner}=scoped(()=>Card({title:"Safe",description:"<img src=x onerror=alert(1)>"}));
    const make=<T,>(fn:()=>T)=>el(runWithOwner(owner,fn));
    expect(make(()=>Container({items:["One"]})).className).toContain("zui-container");
    expect(make(()=>Stack({items:["One"]})).className).toContain("zui-stack");
    expect(make(()=>Inline({items:["One"]})).className).toContain("zui-inline");
    expect(make(()=>Grid({items:["One"],columns:3})).className).toContain("zui-cols--3");
    expect(make(()=>Flex({items:["One"],direction:"column"})).className).toContain("zui-flex--column");
    expect(make(()=>AspectRatio({alt:"Preview",text:"Shown"})).getAttribute("role")).toBe("img");
    expect(make(()=>Card({title:"Card",description:"<script>x()</script>"})).querySelector("script")).toBeNull();
    expect(make(()=>Avatar({name:"Ada Lovelace"})).getAttribute("aria-label")).toBe("Ada Lovelace");
    expect(()=>make(()=>Avatar({name:"Ada",src:"data:image/svg+xml,evil"}))).toThrow();
    expect(make(()=>Skeleton({lines:3})).querySelectorAll(".zui-skeleton")).toHaveLength(3);
    expect(make(()=>LoadingIndicator({label:"Working"})).getAttribute("role")).toBe("status");
    expect(make(()=>Breadcrumbs({items:[{label:"Home",href:"/"},{label:"Current"}]})).querySelector('[aria-current="page"]')?.textContent).toBe("Current");
    expect(make(()=>SidebarLayout({title:"Main",links:[{href:"/",label:"Home"}],body:"Body"})).querySelector("main")?.textContent).toBe("Body");
    expect(make(()=>NavigationMenu({label:"Pages",links:[{href:"/",label:"Home",current:true}]})).querySelector('[aria-current="page"]')).not.toBeNull();
    expect(make(()=>Toast({message:"Hello"})).getAttribute("role")).toBe("status");
    disposeOwner(owner);
  });
  it("disposes bounded toast notifications without a global registry",()=>{
    vi.useFakeTimers();
    try {
      const owner=createOwner();
      const host=document.createElement("div");document.body.appendChild(host);
      const center=runWithOwner(owner,()=>createToastCenter({owner,host,maxVisible:2}));
      center.announce({message:"First",durationMs:25});
      center.announce({message:"Second",durationMs:25});
      center.announce({message:"Third",durationMs:25});
      expect(host.children).toHaveLength(2);
      expect(host.textContent).not.toContain("First");
      vi.advanceTimersByTime(25);
      expect(host.children).toHaveLength(0);
      expect(()=>center.announce({message:"Invalid",durationMs:Infinity})).toThrow(RangeError);
      disposeOwner(owner);expect(host.children).toHaveLength(0);
      expect(()=>center.announce({message:"After dispose"})).toThrow();
      host.remove();
    }finally{vi.useRealTimers();}
  });
  it("adapts a structural forms field while preserving input identity, typed errors and disposal",()=>{
    const value=signal("Ada"), invalid=signal(false), errors=signal<readonly {message:string}[]>([]);
    const blur=vi.fn();
    const {owner,value:bound}=scoped(()=>BoundTextField({id:"nick",label:"Nickname",
      field:{value,ariaInvalid:invalid,visibleErrors:errors,blur}}));
    const root=el(bound),input=root.querySelector<HTMLInputElement>("input")!;
    document.body.appendChild(root);
    input.value="A";input.dispatchEvent(new Event("input",{bubbles:true}));
    expect(value.value).toBe("A");
    invalid.value=true;errors.value=[{message:"Too short"}];flushSync();
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(root.querySelector("#nick-error")?.textContent).toBe("Too short");
    expect(root.querySelector("input")).toBe(input);
    input.dispatchEvent(new Event("blur"));
    expect(blur).toHaveBeenCalledOnce();
    disposeOwner(owner);root.remove();
  });
});
