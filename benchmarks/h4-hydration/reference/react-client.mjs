import React from "react";
import {hydrateRoot} from "react-dom/client";
import {flushSync} from "react-dom";
import {ReactBenchmarkApp} from "./react-app.mjs";

const host=document.querySelector("#app");
const size=Number(host.dataset.size);
const first=Array.from(host.querySelectorAll("[data-key]"));
const draft=host.querySelector("[data-draft]");
const button=host.querySelector("[data-counter]");
draft.value="visitor draft";
draft.focus();
const observer=new MutationObserver(()=>{});
observer.observe(host,{subtree:true,childList:true,attributes:true,characterData:true});
let controls,root;
let clickedAfterDispose=0;
const mark=performance.now();
window.__h4={ready:false};
function finish(actions){
  controls=actions;
  const mutations=observer.takeRecords().length;
  observer.disconnect();
  window.__h4={
    ready:true,
    hydrationMs:performance.now()-mark,
    mutations,
    adopted:first.every((node,i)=>host.querySelectorAll("[data-key]")[i]===node),
    preservedDraft:draft.value==="visitor draft",
    preservedFocus:document.activeElement===draft,
    get liveRows(){return host.querySelectorAll("[data-key]").length;},
    update(){flushSync(()=>controls.update());},
    reverse(){flushSync(()=>controls.reverse());},
    verify(){
      const nodes=host.querySelectorAll("[data-key]");
      return host.querySelector("[data-counter]")?.textContent==="Count: 1" &&
        nodes.length===size && nodes[0]===first[size-1] &&
        nodes[size-1]===first[0] && draft.value==="visitor draft";
    },
    dispose(){
      clickedAfterDispose=0;
      root.unmount();
    },
    verifyDisposed(){
      button.click();
      return clickedAfterDispose===0 && host.querySelectorAll("[data-key]").length===0;
    }
  };
}
root=hydrateRoot(host,React.createElement(ReactBenchmarkApp,{size,onReady:finish}));
