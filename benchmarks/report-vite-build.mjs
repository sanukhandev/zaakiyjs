import {readFile,writeFile} from "node:fs/promises";
const [base,candidate]=await Promise.all(["baseline","candidate"].map(label=>
 readFile("benchmark-artifacts/vite-"+label+".json","utf8").then(JSON.parse)
));
if(base.schemaVersion!==1||candidate.schemaVersion!==1||base.scenarios.length!==3||candidate.scenarios.length!==3)
  throw Error("Incomplete Vite build benchmark");
const lines=["# Vite Plugin real TSX production build comparison","","Pinned Vite 6.4.5, TypeScript and plugin builds, same Node 22 CI runner. One warmup, four recorded runs per module count; diagnostic, not release certification.","",
"| TSX modules | Baseline p50 ms | Candidate p50 ms | Change | Baseline p95 ms | Candidate p95 ms | App gzip bytes |",
"| ---: | ---: | ---: | ---: | ---: | ---: | ---: |"];
for(let i=0;i<3;i++){
 const b=base.scenarios[i],a=candidate.scenarios[i];
 if(b.modules!==a.modules||b.samples!==4||a.samples!==4)throw Error("Non-equivalent Vite comparison");
 if(b.assetSha256!==a.assetSha256)throw Error("Vite optimizer changed deterministic emitted assets");
 if(b.appJsCssGzipBytes!==a.appJsCssGzipBytes)throw Error("Vite output gzip changed");
 for(const x of [a,b])if(!Number.isFinite(x.p50_ms)||!Number.isFinite(x.p95_ms)||x.p95_ms<x.p50_ms)
   throw Error("Invalid timing evidence");
 const pct=(a.p50_ms/b.p50_ms-1)*100;
 lines.push("| "+a.modules+" | "+b.p50_ms.toFixed(1)+" | "+a.p50_ms.toFixed(1)+" | "+
 pct.toFixed(1)+"% | "+b.p95_ms.toFixed(1)+" | "+a.p95_ms.toFixed(1)+" | "+a.appJsCssGzipBytes+" |");
}
lines.push("","All output assets must have identical SHA-256 hashes. No change is accepted if compiler, CSS or sourcemap behavior differs. Repeat independent runs before asserting a speedup.","");
await writeFile("benchmark-artifacts/vite-comparison.md",lines.join("\n"));
console.log(lines.join("\n"));
