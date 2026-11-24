import test from "node:test";
import assert from "node:assert/strict";
import {digest,productionEvidence,validateComparison} from "./vite-production-evidence.mjs";

function assets(entry,code,css=".flex{display:flex}",extra={}){
  return [
    {name:entry,content:code},
    {name:"assets/zaakiy-styles.css",content:css},
    {name:"index.html",content:'<html><head><script type="module" src="/'+entry+'"></script><link rel="stylesheet" href="/assets/zaakiy-styles.css"></head><body></body></html>'},
    {name:"zaakiy-assets.json",content:JSON.stringify({schemaVersion:1,assets:[
      {fileName:entry,kind:"js",sourceFile:"index.html",...extra},
      {fileName:"assets/zaakiy-styles.css",kind:"css"},
      {fileName:"zaakiy-assets.json",kind:"manifest"}
    ]})}
  ];
}
function record(modules,entry,code){
  const output=assets(entry,code);
  const production=productionEvidence(output);
  const compiled=Array.from({length:modules},(_,i)=>({file:"src/component-"+i+".tsx",sha256:digest("compiled"+i)}));
  const evidence={count:modules,styles:["flex","16px","16px"],expected:Array(modules).fill("Count: 1"),mutations:[1,1],identity:true};
  return {
    modules,samples:4,warmups:1,
    p50_ms:10,p95_ms:10,transformP50_ms:3,cssGenerationP50_ms:1,
    assetSha256:digest(JSON.stringify(output)),semanticAssetSha256:digest(JSON.stringify(output)),
    fixtureSha256:digest("fixture"+modules),compilerSha256:digest(JSON.stringify(compiled)),
    production,browser:{status:"passed",sha256:digest(JSON.stringify(evidence)),evidence},
    appJsCssGzipBytes:production.inventory.filter(x=>/\.(js|css)$/.test(x.name)).reduce((n,x)=>n+x.gzipBytes,0),
    samples_ms:[10,10,10,10],transformCalls:[modules,modules,modules,modules],cssGenerationCalls:[1,1,1,1],
    profiles:Array.from({length:4},()=>({transformMs:3,cssGenerateMs:1,transformCalls:modules,cssGenerateCalls:1,compiled}))
  };
}
const report=(entry,code)=>({schemaVersion:2,node:"v22.23.5",scenarios:[1,8,24].map(n=>record(n,entry,code))});
test("normalizes only the validated entry name; retains actual hashes and other asset metadata",()=>{
  const a=productionEvidence(assets("assets/index-aaa.js","old"));
  const b=productionEvidence(assets("assets/index-bbb.js","new"));
  assert.equal(a.htmlSha256,b.htmlSha256);
  assert.equal(a.manifestSha256,b.manifestSha256);
  assert.notEqual(a.entrySha256,b.entrySha256);
  assert.notEqual(a.cssSha256,productionEvidence(assets("assets/index-aaa.js","old","changed")).cssSha256);
  assert.notEqual(a.manifestSha256,productionEvidence(assets("assets/index-aaa.js","old",undefined,{sourceFile:"different.html"})).manifestSha256);
});
test("rejects unlisted outputs, missing references and conflicting duplicate records",()=>{
  const output=assets("assets/index-aaa.js","old");
  assert.throws(()=>productionEvidence([...output,{name:"extra.js",content:"unexpected"}]));
  const broken=structuredClone(output);
  broken[2].content=broken[2].content.replace("index-aaa","index-missing");
  assert.throws(()=>productionEvidence(broken),/references/);
  const dup=JSON.parse(output[3].content);
  dup.assets.push({fileName:"assets/index-aaa.js",kind:"css"});
  output[3].content=JSON.stringify(dup);
  assert.throws(()=>productionEvidence(output),/Conflicting duplicate/);
});
test("strict gate rejects runtime differences; explicit runtime mode requires behavioral and compiler parity",()=>{
  const a=report("assets/index-aaa.js","old");
  const b=report("assets/index-bbb.js","new runtime");
  assert.equal(validateComparison(a,a).length,3);
  assert.throws(()=>validateComparison(a,b),/strict mode/);
  const result=validateComparison(a,b,"reviewed-runtime-delta");
  assert.equal(result.length,3);
  assert.notEqual(result[0].baselineEntrySha256,result[0].candidateEntrySha256);
  for(const key of ["fixtureSha256","compilerSha256"]){
    const altered=structuredClone(b);altered.scenarios[0][key]=digest("different");
    assert.throws(()=>validateComparison(a,altered,"reviewed-runtime-delta"));
  }
  for(const key of ["cssSha256","htmlSha256","manifestSha256"]){
    const altered=structuredClone(b);altered.scenarios[0].production[key]=digest("different");
    assert.throws(()=>validateComparison(a,altered,"reviewed-runtime-delta"));
  }
  const altered=structuredClone(b);
  altered.scenarios[0].browser.evidence.styles[0]="block";
  altered.scenarios[0].browser.sha256=digest(JSON.stringify(altered.scenarios[0].browser.evidence));
  assert.throws(()=>validateComparison(a,altered,"reviewed-runtime-delta"),/native behavior differs/);
});
test("rejects incomplete instrumentation and forged byte accounting",()=>{
  const a=report("assets/index-aaa.js","old");
  for(const change of [
    r=>{r.transformCalls.pop();},
    r=>{r.samples_ms[0]=0;},
    r=>{r.appJsCssGzipBytes++;},
    r=>{r.browser.status="failed";}
  ]){
    const b=structuredClone(a);change(b.scenarios[0]);
    assert.throws(()=>validateComparison(a,b,"reviewed-runtime-delta"));
  }
});
