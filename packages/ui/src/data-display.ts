import type { ViewNode } from "@zaakiyjs/core";
import { native, view, currentOwner, nonEmpty } from "./native.js";
import { listen } from "@zaakiyjs/dom/compiler";
import { createControlledState } from "@zaakiyjs/ui-primitives";
import type { ReadonlySignal } from "@zaakiyjs/signals";

export interface AvatarProps {
  readonly name:string;readonly src?:string;readonly size?:"sm"|"md"|"lg";
}
export function Avatar(props:AvatarProps):ViewNode {
  currentOwner();
  const root=native("span");root.className="zui-avatar zui-avatar--"+(props.size??"md");
  const name=nonEmpty(props.name,"Avatar name");
  root.setAttribute("role","img");root.setAttribute("aria-label",name);
  if(props.src){
    const asset=props.src.trim();
    // Only approved URL schemes and same-origin absolute paths; no opaque data URLs.
    if(!(/^\//u.test(asset)&&!asset.startsWith("//")) && !/^https:\/\//iu.test(asset))
      throw new TypeError("Avatar image must be HTTPS or an absolute application path");
    const image=native("img") as HTMLImageElement;
    image.src=asset;image.alt="";image.decoding="async";
    root.appendChild(image);
  }else {
    const initials=name.split(/\s+/u).slice(0,2).map(v=>v.codePointAt(0)!>0xffff?"•":v[0]?.toLocaleUpperCase()??"").join("");
    root.textContent=initials;
  }
  return view(root);
}
export interface SkeletonProps { readonly label?:string; readonly lines?:1|2|3|4 }
export function Skeleton(props:SkeletonProps):ViewNode {
  currentOwner();
  const root=native("div");root.className="zui-skeleton-group";
  root.setAttribute("role","status");
  root.setAttribute("aria-label",props.label??"Loading");
  for(let i=0;i<(props.lines??1);i++){
    const line=native("span");line.className="zui-skeleton";line.setAttribute("aria-hidden","true");root.appendChild(line);
  }
  return view(root);
}
export interface LoadingIndicatorProps { readonly label?:string }
export function LoadingIndicator(props:LoadingIndicatorProps):ViewNode {
  currentOwner();
  const root=native("span");root.className="zui-spinner";
  root.setAttribute("role","status");root.setAttribute("aria-label",props.label??"Loading");
  return view(root);
}
export interface PaginationProps {
  readonly totalPages:number;
  readonly value?:ReadonlySignal<number>;
  readonly defaultValue?:number;
  readonly onValueChange?:(page:number,detail:{readonly reason:"pointer"|"keyboard"|"programmatic";readonly originalEvent?:Event})=>void;
}
export function Pagination(props:PaginationProps):ViewNode {
  const owner=currentOwner();
  if(!Number.isSafeInteger(props.totalPages)||props.totalPages<1)
    throw new RangeError("totalPages must be a positive integer");
  const initial=props.defaultValue??1;
  if(!Number.isSafeInteger(initial)||initial<1||initial>props.totalPages)
    throw new RangeError("Invalid default page");
  if(props.value&&!props.onValueChange)throw new TypeError("Controlled pagination requires onValueChange");
  const state=createControlledState({owner,value:props.value,defaultValue:initial,
    onValueChange:(v,detail)=>props.onValueChange?.(v,{
      reason:detail.reason==="keyboard"?"keyboard":detail.reason==="pointer"?"pointer":"programmatic",
      originalEvent:detail.originalEvent
    })});
  const nav=native("nav");nav.className="zui-pagination";nav.setAttribute("aria-label","Pagination");
  const prev=native("button") as HTMLButtonElement;
  const next=native("button") as HTMLButtonElement;
  for(const [button,label] of [[prev,"Previous"],[next,"Next"]] as const){
    button.type="button";button.textContent=label;button.className="zui-button zui-button--sm zui-button--neutral zui-button--outline";
    nav.appendChild(button);
  }
  const status=native("span");status.setAttribute("aria-live","polite");
  nav.insertBefore(status,next);
  const update=()=>{
    const p=state.value.value;
    prev.disabled=p<=1;next.disabled=p>=props.totalPages;
    status.textContent="Page "+p+" of "+props.totalPages;
  };
  const effectDispose=subscribe(owner,update);
  listen(owner,prev,"click",event=>state.set(Math.max(1,state.value.peek()-1),{reason:event instanceof MouseEvent&&event.detail===0?"keyboard":"pointer",originalEvent:event}));
  listen(owner,next,"click",event=>state.set(Math.min(props.totalPages,state.value.peek()+1),{reason:event instanceof MouseEvent&&event.detail===0?"keyboard":"pointer",originalEvent:event}));
  // Owner cleanup is registered by DOM listeners and reactive binding.
  void effectDispose;
  return view(nav);
}
import { effect } from "@zaakiyjs/signals";
import { runWithOwner, onCleanup } from "@zaakiyjs/core";
import type { OwnerScope } from "@zaakiyjs/core";
function subscribe(owner:OwnerScope,update:()=>void):void {
  const handle=effect(update,{phase:"render"});
  runWithOwner(owner,()=>onCleanup(()=>handle.dispose()));
}
