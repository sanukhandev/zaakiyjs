import {readFile,writeFile} from "node:fs/promises";
const [before,after]=await Promise.all(["baseline","candidate"].map(tag=>
 readFile("benchmark-artifacts/roving-"+tag+".json","utf8").then(JSON.parse)
));
if(before.schemaVersion!==1||after.schemaVersion!==1||before.scenarios.length!==3||after.scenarios.length!==3)
 throw Error("Incomplete roving benchmark comparison");
const lines=[
 "# Roving Focus initial registration and owner cleanup",
 "",
 "JSDOM 26 DOM benchmark, Node 22, same fixture and 10 measured samples. Browser keyboard behavior is separately verified in Chromium/Firefox/WebKit.",
 "",
 "| Items | Baseline create p50 ms | Candidate create p50 ms | Create reduction | Baseline teardown p50 ms | Candidate teardown p50 ms |",
 "| ---: | ---: | ---: | ---: | ---: | ---: | ---: |"
];
for(let i=0;i<3;i++){
 const b=before.scenarios[i],a=after.scenarios[i];
 if(b.count!==a.count||b.samples!==10||a.samples!==10)throw Error("Incomparable roving fixture");
 for(const side of ["create","dispose"])for(const x of [a[side],b[side]]){
  if(x.samples_ms.length!==10||!x.samples_ms.every(Number.isFinite)||x.p95_ms<x.p50_ms)
   throw Error("Invalid roving samples");
 }
 const delta=(1-a.create.p50_ms/b.create.p50_ms)*100;
 lines.push("| "+a.count+" | "+b.create.p50_ms.toFixed(3)+" | "+a.create.p50_ms.toFixed(3)+
  " | "+delta.toFixed(1)+"% | "+b.dispose.p50_ms.toFixed(3)+" | "+a.dispose.p50_ms.toFixed(3)+" |");
}
lines.push("","This measures jsdom style reads and owner cleanup, not browser frame time. Retained item identity and tabindex disposal are asserted for every sample.","");
await writeFile("benchmark-artifacts/roving-comparison.md",lines.join("\n"));
console.log(lines.join("\n"));
