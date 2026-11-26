import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { validateComparison } from "./vite-production-evidence.mjs";
const dir = resolve(process.argv[2] ?? "benchmark-artifacts");
const mode=process.argv[3]??"strict";
if(!["strict","reviewed-runtime-delta"].includes(mode))throw Error("Unknown B8 comparison mode");
const read = async file => JSON.parse(await readFile(resolve(dir, file), "utf8"));
const frozen = await read("b8-vite-frozen.json");
const candidate = await read("b8-vite-candidate.json");
const comparisons=validateComparison(frozen,candidate,mode);
const lines = [
  "# B8 — Vite build phase profiling",
  "",
  "Same-run pinned Vite production builds for both the frozen B0–B5 consolidated implementation and PR candidate.",
  "Comparison mode: "+mode+". All fixture sources, compiler output, CSS, normalized HTML/manifest metadata and native browser behavior must match.",
  "",
  "| TSX modules | Frozen total p50 | Candidate total p50 | Candidate TSX transform p50 | Candidate CSS/manifest generation p50 | Frozen JS/CSS gzip | Candidate JS/CSS gzip |",
  "| ---: | ---: | ---: | ---: | ---: | ---: | ---: |"
];
for(let i=0;i<3;i++){
  const b=frozen.scenarios[i],c=candidate.scenarios[i];
  lines.push("| "+c.modules+" | "+b.p50_ms.toFixed(1)+" ms | "+c.p50_ms.toFixed(1)+" ms | "+
    c.transformP50_ms.toFixed(1)+" ms | "+c.cssGenerationP50_ms.toFixed(1)+" ms | "+b.appJsCssGzipBytes+" B | "+c.appJsCssGzipBytes+" B |");
}
lines.push("", mode==="strict"
  ?"All executable asset contents and canonical manifest semantic hashes match; JS/CSS gzip byte counts match."
  :"Executable entry bytes may differ only in explicit reviewed-runtime-delta mode. Full hashes, byte deltas and browser assertion evidence are retained; the comparison does not authorize arbitrary compiler, CSS, manifest or HTML changes. Bundle-size increases still require review.",
  "Every variant independently produced identical raw assets over repeated builds. Conflicting duplicate manifest entries are rejected; only the validated entry filename is normalized for runtime comparisons.",
  "Phase totals overlap other build work and are not additive to wall time. Browser verification is outside measured build time. HMR latency is not measured.", "");
await mkdir(dir,{recursive:true});
await writeFile(resolve(dir,"b8-vite-comparison.json"),JSON.stringify({schemaVersion:2,mode,comparisons},null,2)+"\n");
await writeFile(resolve(dir,"b8-vite-phase-report.md"),lines.join("\n"));
console.log(lines.join("\n"));
