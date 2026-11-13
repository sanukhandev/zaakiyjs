import {bootstrapApplication} from "@angular/platform-browser";
import {RootComponent,clientProviders} from "./app";

const host=document.querySelector("h4-root");
if(!host) throw new Error("Angular SSR root was not rendered");
const before=Array.from(host.querySelectorAll<HTMLElement>("[data-key]"));
const draft=host.querySelector<HTMLInputElement>("[data-draft]");
if(!draft || before.length===0) throw new Error("Angular SSR HTML is incomplete");
draft.value="visitor draft";
draft.focus();
const observer=new MutationObserver(()=>{});
observer.observe(host,{subtree:true,childList:true,attributes:true,characterData:true});
const capture={started:performance.now(),before,draft,observer};
const state=window as typeof window & {
  __h4Pre?:typeof capture;
  __h4App?:ReturnType<typeof bootstrapApplication>;
  __h4?:unknown;
};
state.__h4Pre=capture;
state.__h4App=bootstrapApplication(RootComponent,{providers:clientProviders});
state.__h4App.catch(error=>{
  observer.disconnect();
  state.__h4={ready:true,error:String(error)};
});
