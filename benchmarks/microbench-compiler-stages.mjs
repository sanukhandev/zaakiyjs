import { performance } from "node:perf_hooks";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(process.argv[2] ?? ".");
const output = resolve(process.argv[3] ?? "benchmark-artifacts/compiler-stages.json");
const url = filename => pathToFileURL(join(root, "packages/compiler/dist", filename)).href;
const { analyze } = await import(url("analysis.js"));
const { optimizeIR } = await import(url("optimize.js"));
const { typeDiagnostics, emitJavaScript } = await import(url("generate.js"));
const percentile = (items, fraction) => {
  const values = [...items].sort((a,b) => a-b);
  const at = (values.length-1)*fraction;
  const left = Math.floor(at), right = Math.ceil(at);
  return values[left]+(values[right]-values[left])*(at-left);
};
const sizes = [1,8,24];
const iterations = 4;
const warmups = 1;
const records = [];
for (const count of sizes) {
  const folder = await mkdtemp(join(root, ".benchmark-compiler-stages-"));
  try {
    const src = join(folder, "src");
    await mkdir(src, { recursive: true });
    const requests = [];
    for (let index=0; index<count; index++) {
      const fileName = join(src, "component-"+index+".tsx");
      const content =
        'import {signal} from "@zaakiyjs/signals";\n'+
        'import {mount} from "@zaakiyjs/dom";\n'+
        'const clicks=signal(0);\n'+
        'mount(() => <button class="flex gap-4 p-4" onClick={() => clicks.value++}>Count: {clicks.value}</button>, document.getElementById("app")!);\n';
      await writeFile(fileName, content);
      requests.push({ fileName, source: content, rootDir: root });
    }
    const samples = [];
    let priorHash = null;
    for (let attempt=-warmups; attempt<iterations; attempt++) {
      const durations = { analyzeMs:0, optimizeMs:0, typeDiagnosticsMs:0, emitMs:0 };
      const hash = createHash("sha256");
      for (const request of requests) {
        let start=performance.now();
        const analyzed=analyze(request);
        durations.analyzeMs+=performance.now()-start;
        if (analyzed.diagnostics.some(d=>d.severity==="error")) {
          throw new Error("Unexpected compiler analysis diagnostic");
        }
        start=performance.now();
        const ir=optimizeIR(analyzed.document);
        durations.optimizeMs+=performance.now()-start;
        start=performance.now();
        const errors=typeDiagnostics(request,analyzed);
        durations.typeDiagnosticsMs+=performance.now()-start;
        if (errors.some(d=>d.severity==="error")) {
          throw new Error("Type diagnostics failed: "+JSON.stringify(errors.slice(0,3)));
        }
        start=performance.now();
        const emitted=emitJavaScript(request,analyzed,ir);
        durations.emitMs+=performance.now()-start;
        if (!emitted.code || !emitted.map) {
          throw new Error("Compiler did not emit JS and original source map");
        }
        hash.update("component-"+requests.indexOf(request)+"\0"+emitted.code+"\0");
      }
      const digest=hash.digest("hex");
      if (priorHash && priorHash!==digest) {
        throw new Error("Non-deterministic compiler output during profiling");
      }
      priorHash=digest;
      if (attempt>=0) samples.push({ ...durations,
        sumMs: Object.values(durations).reduce((a,b)=>a+b,0) });
    }
    records.push({
      modules:count,samples:iterations,warmups,
      sha256:priorHash,
      stages:Object.fromEntries(["analyzeMs","optimizeMs","typeDiagnosticsMs","emitMs","sumMs"]
        .map(name=>[name,{p50_ms:percentile(samples.map(s=>s[name]),.5),
          p95_ms:percentile(samples.map(s=>s[name]),.95)}])),
      raw:samples
    });
  } finally { await rm(folder,{recursive:true,force:true}); }
}
await mkdir(resolve(output,".."),{recursive:true});
await writeFile(output,JSON.stringify({schemaVersion:1,node:process.version,root,records},null,2)+"\n");
console.log(records.map(r=>r.modules+" modules: type-check "+r.stages.typeDiagnosticsMs.p50_ms.toFixed(1)+
  "ms / total staged "+r.stages.sumMs.p50_ms.toFixed(1)+"ms").join("\n"));