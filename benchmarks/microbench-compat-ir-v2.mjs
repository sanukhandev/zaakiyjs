import { performance } from "node:perf_hooks";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(process.argv[2] ?? ".");
const out = resolve(process.argv[3] ?? "benchmark-artifacts/compat-ir-v2.json");
const { analyzeCompatibility, serializeManifest } = await import(
  pathToFileURL(join(root, "packages/compat/dist/index.js")).href
);
const targets = { browsers: ["chrome >=124", "firefox >=124", "safari >=17.4"] };
function percentile(values, fraction) {
  const sorted = [...values].sort((a,b)=>a-b);
  const at=(sorted.length-1)*fraction,lo=Math.floor(at),hi=Math.ceil(at);
  return sorted[lo]+(sorted[hi]-sorted[lo])*(at-lo);
}
const cases = [];
let deepNode = { kind: "CompatFeature", feature: "web.fetch",
  span: {file:"deep.tsx",start:{line:1,column:1,offset:0}} };
for(let i=0;i<12_000;i++) deepNode={kind:"StaticElement",children:[deepNode]};
cases.push({name:"deep-12k",nodes:[deepNode],expected:1});
const slots=Array.from({length:1_000},(_,i)=>({
  name:"slot"+i, children:[{kind:"CompatFeature",feature:"web.fetch",
    span:{file:"slots.tsx",start:{line:i+1,column:1,offset:i*4}}}]
}));
cases.push({name:"slots-1k",nodes:[{kind:"ComponentCall",slots}],expected:1_000});
const results=[];
for(const scenario of cases){
  const samples=[];
  let checksum="";
  for(let i=-3;i<20;i++){
    const start=performance.now();
    const analysis=analyzeCompatibility({
      mode:"strict",targets,ir:[{irVersion:2,sourceFile:scenario.name+".tsx",nodes:scenario.nodes}]
    });
    const elapsed=performance.now()-start;
    if(!analysis.ok||analysis.manifest.detectedFeatures.length!==1||
       analysis.manifest.detectedFeatures[0].requiredBy.length!==scenario.expected){
      throw Error("Incorrect IR v2 feature detection: "+scenario.name);
    }
    const current=createHash("sha256").update(serializeManifest(analysis.manifest)).digest("hex");
    if(checksum&&checksum!==current)throw Error("Nondeterministic compatibility manifest: "+scenario.name);
    checksum=current;
    if(i>=0)samples.push(elapsed);
  }
  const p50=percentile(samples,.5),p95=percentile(samples,.95),p99=percentile(samples,.99);
  // A generous timeout guard detects algorithmic explosions, not a cross-host speed target.
  if(p95>3_000)throw Error("Unbounded compatibility analysis latency: "+scenario.name);
  results.push({name:scenario.name,features:scenario.expected,checksum,
    warmups:3,samples:20,p50_ms:p50,p95_ms:p95,p99_ms:p99,rawSamples_ms:samples});
  console.log(scenario.name,"p50",p50.toFixed(3),"ms p95",p95.toFixed(3),"ms");
}
await mkdir(dirname(out),{recursive:true});
await writeFile(out,JSON.stringify({schemaVersion:1,nodeVersion:process.version,
  method:"Read-only compiler IR v2 compatibility analysis, 3 warmups + 20 samples, deterministic SHA-256 of manifest. CPU workload, no browser transforms or DOM performance.",results},null,2)+"\n");
