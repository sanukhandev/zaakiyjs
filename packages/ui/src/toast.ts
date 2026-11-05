import type { OwnerScope } from "@zaakiyjs/core";
import { onCleanup,runWithOwner } from "@zaakiyjs/core";
import { native,view,currentOwner } from "./native.js";
import type { ViewNode } from "@zaakiyjs/core";
export type ToastTone="info"|"success"|"warning"|"danger";
export interface ToastPayload { readonly message:string;readonly tone?:ToastTone;readonly durationMs?:number }
export interface ToastCenter {
  announce(toast:ToastPayload):void;
  dismissAll():void;
  dispose():void;
}
export interface ToastCenterOptions {
  readonly host:HTMLElement;
  readonly owner:OwnerScope;
  readonly maxVisible?:number;
}
/** Explicit root-scoped notification service. No process-global toast registry. */
export function createToastCenter(options:ToastCenterOptions):ToastCenter {
  const {host,owner}=options;
  if(owner.disposed)throw new Error("Cannot attach to disposed owner");
  const maximum=options.maxVisible??4;
  if(!Number.isSafeInteger(maximum)||maximum<1||maximum>20)throw new RangeError("Invalid toast capacity");
  const mounted=new Set<{node:HTMLElement;timer:ReturnType<typeof setTimeout>|null}>();
  let closed=false;
  const remove=(record:{node:HTMLElement;timer:ReturnType<typeof setTimeout>|null})=>{
    if(record.timer!==null)clearTimeout(record.timer);
    record.node.remove();mounted.delete(record);
  };
  const dismissAll=()=>{for(const record of [...mounted])remove(record);};
  const dispose=()=>{if(closed)return;closed=true;dismissAll();};
  runWithOwner(owner,()=>onCleanup(dispose));
  return {
    announce(toast){
      if(closed||owner.disposed)throw new Error("Toast center disposed");
      const tone=toast.tone??"info";
      const node=native("div");node.className="zui-toast zui-toast--"+tone;
      node.setAttribute("role",tone==="danger"?"alert":"status");
      node.setAttribute("aria-live",tone==="danger"?"assertive":"polite");
      node.textContent=toast.message;
      if(mounted.size>=maximum){const oldest=mounted.values().next().value;if(oldest)remove(oldest);}
      const record:{node:HTMLElement;timer:ReturnType<typeof setTimeout>|null}={node,timer:null};
      mounted.add(record);host.appendChild(node);
      const duration=toast.durationMs??5000;
      if(!Number.isFinite(duration)||duration<0||duration>120000)throw new RangeError("Invalid toast duration");
      if(duration>0)record.timer=setTimeout(()=>{if(!owner.disposed)remove(record);},duration);
    },
    dismissAll,dispose
  };
}
export interface ToastProps extends ToastPayload {}
/** A standalone announcement. For concurrent toasts, prefer createToastCenter. */
export function Toast(props:ToastProps):ViewNode {
  currentOwner();
  const node=native("div");const tone=props.tone??"info";
  node.className="zui-toast zui-toast--"+tone;
  node.setAttribute("role",tone==="danger"?"alert":"status");
  node.setAttribute("aria-live",tone==="danger"?"assertive":"polite");
  node.textContent=props.message;
  return view(node);
}
