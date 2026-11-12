/**
 * H6 Node/CI fixture: emit real compiler-authored server HTML and a Vite
 * client bundle referencing @zaakiyjs/ssr/client, never a browser compiler.
 */
import { resolve, join } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { Buffer } from "node:buffer";
import { TextEncoder } from "node:util";
import { build } from "vite";
import { compileDataServer } from "../../../compiler/dist/index.js";
import { buildVerifiedManifestV1 } from "../../dist/build.js";

const root = resolve(".");
const routeId = "counter";
const source = [
  "function Counter(props: { count: number }) {",
  'return <main class="counter"><button type="button">Count: {props.count}</button><input value="server"></input></main>;',
  "}"
].join("\n");
const compiled = compileDataServer({
  fileName: "packages/ssr/test/browser/counter.tsx",
  routeId, source, hydratable: true
});
if (compiled.diagnostics.some(d => d.severity === "error") ||
    !compiled.js[0] || !compiled.hydrationPlan) {
  throw new Error("Compiler failed to generate the hydration fixture");
}
const moduleBytes = new TextEncoder().encode(compiled.js[0].code);
const generatedUrl = "data:text/javascript;base64," +
  Buffer.from(moduleBytes).toString("base64");
const generated = await import(generatedUrl);
if (generated.protocol !== "zaakiy.render/1" ||
    JSON.stringify(generated.hydrationPlan) !== JSON.stringify(compiled.hydrationPlan))
  throw new Error("Compiled module and hydration plan differ");
const response = generated.render({
  schema: "zaakiy.render/1",
  route: { id: routeId },
  request: { signal: new globalThis.AbortController().signal },
  loaderData: { count: 0 }
});
if (response.status !== 200 || typeof response.body !== "string")
  throw new Error("Unexpected server fixture response");
const manifest = buildVerifiedManifestV1([
  { routeId, moduleId: "generated/counter", bytes: moduleBytes }
]);
const envelope = {
  schema: "zaakiy.hydration/1", buildId: manifest.buildId,
  domAbiVersion: 1, routeId, payload: null,
  boundaries: [{
    markerId: compiled.hydrationPlan.markerId,
    templateDigest: compiled.hydrationPlan.templateDigest
  }]
};
const fixtureDir = join(root, "packages/ssr/.hydration-fixture");
const distDir = join(root, "benchmark-artifacts/hydration-browser");
await mkdir(fixtureDir, { recursive: true });
await mkdir(distDir, { recursive: true });
const code = [
  'import { hydrateDataPage } from "@zaakiyjs/ssr/client";',
  'import { signal, flushSync } from "@zaakiyjs/signals";',
  "const plan = " + JSON.stringify(compiled.hydrationPlan) + ";",
  "const manifest = " + JSON.stringify(manifest) + ";",
  "const envelope = " + JSON.stringify(envelope) + ";",
  "const originalHtml = " + JSON.stringify(response.body) + ";",
  'const container = document.querySelector("#app");',
  'const button = container.querySelector("button");',
  'const input = container.querySelector("input");',
  'const originalElements = [...container.querySelectorAll("*")];',
  'const originalText = [...button.childNodes].find(n => n.nodeType === 3 && n.nodeValue === "0");',
  'const buttonPlan = plan.root.children.find(x => x.kind === "element" && x.tag === "button");',
  'const count = signal(0);',
  'const read = path => path.join(".") === "count" ? count.value : null;',
  'input.value = "visitor draft";',
  'input.focus();',
  'input.setSelectionRange(2, 5);',
  'const observer = new MutationObserver(() => {});',
  'observer.observe(container, { subtree: true, childList: true, attributes: true, characterData: true });',
  'let clicked = 0;',
  'let handle;',
  'try {',
  '  const started = performance.now();',
  '  handle = hydrateDataPage(container, plan, envelope, manifest, "counter", {',
  '    read, events: [{ elementId: buttonPlan.id, name: "click", handler() {',
  '      clicked++; count.value++; flushSync();',
  '    } }]',
  '  });',
  '  const adoptionMs = performance.now() - started;',
  '  const mutations = observer.takeRecords().length;',
  '  const identity = originalElements.every((node,i) => node === container.querySelectorAll("*")[i]);',
  '  const preservedFocus = document.activeElement === input;',
  '  const preservedSelection = input.selectionStart === 2 && input.selectionEnd === 5;',
  '  const preservedDraft = input.value === "visitor draft";',
  '  const stableText = originalText && originalText.nodeValue === "0";',
  '  const samples = [];',
  '  for(let i=0;i<40;i++){',
  '    const temp = document.createElement("div"); temp.innerHTML = originalHtml;',
  '    const start = performance.now();',
  '    const childHandle = hydrateDataPage(temp, plan, envelope, manifest, "counter", { read: () => 0 });',
  '    samples.push(performance.now() - start); childHandle.dispose();',
  '  }',
  '  samples.sort((a,b) => a-b);',
  '  const percentile = f => {',
  '    const n=(samples.length-1)*f, low=Math.floor(n), high=Math.ceil(n);',
  '    return samples[low]+(samples[high]-samples[low])*(n-low);',
  '  };',
  '  window.__zaakiyHydration = {',
  '    ready:true, adoptionMs, p50Ms:percentile(.5), p95Ms:percentile(.95),',
  '    samples, mutations, identity, preservedFocus, preservedSelection, preservedDraft, stableText,',
  '    get clicks(){ return clicked; },',
  '    get buttonText(){ return button.textContent; },',
  '    get textIdentity(){ return [...button.childNodes].includes(originalText); },',
  '    dispose:() => handle.dispose()',
  '  };',
  '} catch(error) { window.__zaakiyHydration = { ready:true, error:String(error) }; }',
  'finally { observer.disconnect(); }'
].join("\n");
const entryPath = join(fixtureDir, "entry.ts");
await writeFile(entryPath, code);
await build({
  configFile: false, root, publicDir: false, logLevel: "warn",
  build: {
    outDir: distDir, emptyOutDir: true, minify: "esbuild",
    lib: { entry: entryPath, formats: ["es"], fileName: "hydration" }
  }
});
await writeFile(join(distDir, "index.html"),
  '<!doctype html><html><head><meta charset="utf-8"><title>Native hydration test</title></head>' +
  '<body><div id="app">' + response.body +
  '</div><script type="module" src="./hydration.js"></script></body></html>');
console.log(JSON.stringify({
  routeId, markerId: compiled.hydrationPlan.markerId,
  buildId: manifest.buildId, htmlBytes: response.body.length
}));
