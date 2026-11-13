import { readFile,writeFile } from "node:fs/promises";
const read=async file=>JSON.parse(await readFile("benchmark-artifacts/"+file,"utf8"));
const baseline=await read("compiler-stages-frozen.json");
const candidate=await read("compiler-stages-candidate.json");
if(baseline.schemaVersion!==1||candidate.schemaVersion!==1||
 baseline.records.length!==3||candidate.records.length!==3)throw Error("Incomplete compiler profiler");
const lines=["# B8 compiler TSX phase breakdown","",
 "Frozen consolidated B0-B5 vs candidate, pinned Node 22; stages use internal compiler modules from real production builds.",
 "",
 "| Modules | Frozen total | Candidate total | Analysis | IR optimization | Type diagnostics | JS/sourcemap emission |",
 "| ---: | ---: | ---: | ---: | ---: | ---: | ---: |"];
for(let i=0;i<3;i++){
 const a=baseline.records[i],b=candidate.records[i];
 if(a.modules!==b.modules||a.samples!==4||b.samples!==4||
    a.raw.length!==4||b.raw.length!==4)throw Error("Compiler profiling sample mismatch");
 for(const r of [a,b]){
  for(const s of Object.values(r.stages)){
    if(!Number.isFinite(s.p50_ms)||!Number.isFinite(s.p95_ms)||
       s.p95_ms<s.p50_ms)throw Error("Invalid compiler stage measurement");
  }
 }
 const f=n=>n.toFixed(1)+" ms";
 lines.push("| "+b.modules+" | "+f(a.stages.sumMs.p50_ms)+" | "+
 f(b.stages.sumMs.p50_ms)+" | "+f(b.stages.analyzeMs.p50_ms)+" | "+
 f(b.stages.optimizeMs.p50_ms)+" | "+f(b.stages.typeDiagnosticsMs.p50_ms)+" | "+
 f(b.stages.emitMs.p50_ms)+" |");
}
lines.push("","The measurements isolate compiler stages only, not Vite/Rollup or full application build. The program is created independently for each module under the current compiler API. No caching change is implied by this diagnostic.", "");
await writeFile("benchmark-artifacts/compiler-stage-report.md",lines.join("\n"));
console.log(lines.join("\n"));