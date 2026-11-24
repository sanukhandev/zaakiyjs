import { performance } from "node:perf_hooks";
import { createRequire } from "node:module";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { mkdir, writeFile } from "node:fs/promises";

const root = resolve(process.argv[2] ?? ".");
const output = resolve(process.argv[3] ?? "benchmark-artifacts/e5-crud.json");
const load = path => import(pathToFileURL(join(root, path)).href);
const { JSDOM } = createRequire(pathToFileURL(join(root, "packages/dom/package.json")))("jsdom");
const [{ createOwner, disposeOwner, mountOwner, onCleanup },
  { flushSync }, { bindKeyedRegion, createRegion },
  { createStore }, { createForm }, { createTask },
  { createRouter, createMemoryHistory }] = await Promise.all([
  load("packages/core/dist/index.js"), load("packages/signals/dist/index.js"),
  load("packages/dom/dist/compiler.js"), load("packages/store/dist/index.js"),
  load("packages/forms/dist/index.js"), load("packages/async/dist/index.js"),
  load("packages/router/dist/index.js")
]);
const percentile = (items, fraction) => {
  const sorted = [...items].sort((a,b) => a-b);
  const position = (sorted.length - 1) * fraction;
  const low = Math.floor(position), high = Math.ceil(position);
  return sorted[low] + (sorted[high] - sorted[low]) * (position - low);
};
async function scenario(count) {
  const dom = new JSDOM("<!doctype html><body></body>", { url: "https://app.example.test/records" });
  const oldDocument = globalThis.document;
  globalThis.document = dom.window.document;
  const owner = createOwner();
  const host = dom.window.document.createElement("section");
  dom.window.document.body.append(host);
  const target = Math.floor(count / 2);
  const values = Array.from({length: count},(_,id)=>({id,title:"Row "+id}));
  const store = createStore({
    owner,
    state: { rows: values },
    actions: write => ({
      rename(id,title) {
        write.update("rows", previous => previous.map(item =>
          item.id === id ? { id: item.id, title } : item));
      }
    })
  });
  let viewCreates = 0, viewUpdates = 0, cleanups = 0;
  bindKeyedRegion(owner, createRegion(host), () => store.state.rows.value,
    item => item.id, item => {
      viewCreates++;
      onCleanup(() => { cleanups++; });
      const node = dom.window.document.createElement("input");
      node.dataset.id = String(item.id);
      node.value = item.title;
      return { node, update(next) {
        viewUpdates++;
        if (node.value !== next.title) node.value = next.title;
      } };
    });
  mountOwner(owner);
  const inputs = [...host.querySelectorAll("input")];
  const focused = inputs[target];
  focused.focus();
  focused.setSelectionRange(1,3);
  const observer = new dom.window.MutationObserver(() => undefined);
  observer.observe(host,{childList:true,subtree:true});
  const form = createForm({
    owner,
    initialValues: { title: "Form-submitted" },
    onSubmit: async data => { store.actions.rename(target, data.title); return "saved"; }
  });
  form.field("title", { required: true });
  const task = createTask({
    owner,
    concurrency: "latest",
    execute: async ({ input }) => input.toUpperCase()
  });
  const router = createRouter({
    owner, history: createMemoryHistory("/records"),
    routes: [
      {id:"records",path:"/records"},
      {id:"record",path:"/records/:id",loader:({params})=>({id:params.id})}
    ]
  });
  const samples = [];
  const warmups = 8, measured = 60;
  let measuredUpdates = 0;
  let lifecycle;
  try {
    for(let i=-warmups;i<measured;i++){
      const began = performance.now();
      const title = "Updated "+i;
      store.actions.rename(target,title);
      flushSync();
      const elapsed = performance.now()-began;
      if(focused.value!==title || focused!==host.querySelectorAll("input")[target] ||
          focused.selectionStart!==1 || focused.selectionEnd!==3) {
        throw Error("E5 focused-row update failed");
      }
      if(i>=0) samples.push(elapsed);
    }
    measuredUpdates = viewUpdates;
    if(viewCreates!==count || observer.takeRecords().length!==0 ||
      [...host.querySelectorAll("input")].some((node,index)=>node!==inputs[index])) {
      throw Error("E5 update changed unrelated native DOM");
    }
    const saved = await form.submit();
    flushSync();
    if(saved.status!=="success" || focused.value!=="Form-submitted") {
      throw Error("E5 form/Store submission failure");
    }
    if(await task.run("saved")!=="SAVED") throw Error("E5 task failure");
    await router.start();
    if((await router.navigate("/records/"+target)).status!=="committed" ||
       router.signals.params.value.id!==String(target)) throw Error("E5 routing failure");
    lifecycle = {
      formSubmission: saved.status, taskResult: task.result.value,
      activeRoute: router.signals.params.value.id
    };
  } finally {
    observer.disconnect();
    router.dispose();
    task.dispose();
    form.dispose();
    disposeOwner(owner);
    dom.window.close();
    globalThis.document = oldDocument;
  }
  if(cleanups!==count) throw Error("E5 owner cleanup mismatch");
  return {
    rows:count, warmups, measured, viewCreates, viewUpdatesPerEdit:measuredUpdates/(warmups+measured),
    cleanups, mutations:0, nodeIdentityPreserved:true,
    p50_ms:percentile(samples,.5),p95_ms:percentile(samples,.95),
    samples_ms:samples, lifecycle
  };
}
const scenarios=[];
for(const rows of [300,700]) scenarios.push(await scenario(rows));
const record={schemaVersion:1,fixture:"crud-store-keyed-forms-task-router-v1",
  node:process.version,root,scenarios};
await mkdir(resolve(output,".."),{recursive:true});
await writeFile(output,JSON.stringify(record,null,2)+"\n");
console.log(scenarios.map(x=>({
  rows:x.rows,p50_ms:x.p50_ms,p95_ms:x.p95_ms,
  viewUpdatesPerEdit:x.viewUpdatesPerEdit
})));