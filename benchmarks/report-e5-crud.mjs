import { readFile, writeFile } from "node:fs/promises";
const read = async name => JSON.parse(await readFile("benchmark-artifacts/"+name,"utf8"));
const [baseline,candidate] = await Promise.all([read("e5-before.json"),read("e5-after.json")]);
if(baseline.schemaVersion!==1||candidate.schemaVersion!==1 ||
   baseline.fixture!==candidate.fixture || baseline.scenarios.length!==2 ||
   candidate.scenarios.length!==2) throw Error("E5 comparison fixture mismatch");
const lines=["# E5 — CRUD integrated native DOM benchmark","",
 "Frozen pre-E5 implementation vs candidate. Same Node/jsdom workload runs Store actions, keyed native DOM, Forms submission, Async Task, Router navigation, disposal.",
 "Edit timings exclude initial mount, form submission and routing; those steps are validated for correctness, not timed.",
 "",
 "| Rows | Baseline p50 | Candidate p50 | p50 change | Baseline updates/edit | Candidate updates/edit |",
 "| ---: | ---: | ---: | ---: | ---: | ---: |"];
for(let i=0;i<2;i++){
 const a=baseline.scenarios[i],b=candidate.scenarios[i];
 if(a.rows!==b.rows||a.viewCreates!==b.viewCreates ||
   a.cleanups!==a.rows || b.cleanups!==b.rows ||
   a.mutations!==0 || b.mutations!==0 ||
   a.lifecycle.formSubmission!=="success" || b.lifecycle.formSubmission!=="success" ||
   a.lifecycle.taskResult!=="SAVED" || b.lifecycle.taskResult!=="SAVED" ||
   a.lifecycle.activeRoute!==String(a.rows/2) || b.lifecycle.activeRoute!==String(b.rows/2) ||
   ![a.p50_ms,b.p50_ms,a.p95_ms,b.p95_ms].every(Number.isFinite) ||
   a.samples_ms.length!==60||b.samples_ms.length!==60 ||
   b.viewUpdatesPerEdit!==1) throw Error("E5 benchmark correctness/parity failure");
 const pct=(b.p50_ms/a.p50_ms-1)*100;
 lines.push("| "+a.rows+" | "+a.p50_ms.toFixed(3)+" ms | "+b.p50_ms.toFixed(3)+" ms | "+
   pct.toFixed(1)+"% | "+a.viewUpdatesPerEdit+" | "+b.viewUpdatesPerEdit+" |");
}
lines.push("",
 "This is a matched Node/jsdom diagnostic. It is **not** browser INP, 100–700 field validation, heap certification or a React/Angular/Vue equivalent.",
 "No throughput claim should be generalized beyond the specified Store edit + keyed DOM fixture.","");
await writeFile("benchmark-artifacts/e5-crud-comparison.md",lines.join("\n"));
console.log(lines.join("\n"));