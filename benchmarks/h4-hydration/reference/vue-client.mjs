import {nextTick} from "vue";
import {makeVueApp} from "./vue-app.mjs";

const host=document.querySelector("#app");
const size=Number(host.dataset.size);
const first=Array.from(host.querySelectorAll("[data-key]"));
const draft=host.querySelector("[data-draft]");
const button=host.querySelector("[data-counter]");
draft.value="visitor draft";
draft.focus();
const observer=new MutationObserver(()=>{});
observer.observe(host,{subtree:true,childList:true,attributes:true,characterData:true});
let actions,app;
const mark=performance.now();
window.__h4={ready:false};
function finish(controls){
  actions=controls;
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
    async update(){actions.update();await nextTick();},
    async reverse(){actions.reverse();await nextTick();},
    verify(){
      const nodes=host.querySelectorAll("[data-key]");
      return host.querySelector("[data-counter]")?.textContent==="Count: 1" &&
        nodes.length===size && nodes[0]===first[size-1] &&
        nodes[size-1]===first[0] && draft.value==="visitor draft";
    },
    dispose(){app.unmount();},
    verifyDisposed(){
      button.click();
      return host.querySelectorAll("[data-key]").length===0;
    }
  };
}
app=makeVueApp(size,finish);
app.mount(host);
