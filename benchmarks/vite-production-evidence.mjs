/** Integrity evidence for the deliberately single-entry B8 fixture.
 * Normalize only the verified entry filename; never discard CSS, manifest
 * metadata, compiler code, or other emitted assets.
 */
import {createHash} from "node:crypto";
import {gzipSync} from "node:zlib";

export const digest=value=>createHash("sha256").update(value).digest("hex");
export function canonicalManifest(content) {
  const parsed=JSON.parse(content);
  if(parsed.schemaVersion!==1||!Array.isArray(parsed.assets))throw Error("Invalid versioned asset manifest");
  const unique=new Map();
  for(const entry of parsed.assets){
    if(!entry||typeof entry.fileName!=="string"||typeof entry.kind!=="string")
      throw Error("Malformed asset metadata");
    const old=unique.get(entry.fileName);
    if(old!==undefined&&JSON.stringify(old)!==JSON.stringify(entry))
      throw Error("Conflicting duplicate asset records");
    unique.set(entry.fileName,entry);
  }
  return {...parsed,assets:[...unique.values()].sort((a,b)=>a.fileName.localeCompare(b.fileName))};
}

export function productionEvidence(assets){
  const files=new Map(assets.map(asset=>[asset.name,asset.content]));
  if(files.size!==assets.length)throw Error("Duplicate emitted files");
  const js=assets.filter(item=>item.name.endsWith(".js"));
  if(js.length!==1||!/^assets\/index-[A-Za-z0-9_-]+\.js$/.test(js[0].name))
    throw Error("B8 runtime comparison requires one hashed entry chunk");
  const entry=js[0].name;
  const html=files.get("index.html"),css=files.get("assets/zaakiy-styles.css");
  const manifest=files.get("zaakiy-assets.json");
  if(typeof html!=="string"||!css||!manifest||assets.length!==4)
    throw Error("Unexpected B8 production asset inventory");
  const normalized=canonicalManifest(manifest);
  const expected=new Map([[entry,"js"],["assets/zaakiy-styles.css","css"],["zaakiy-assets.json","manifest"]]);
  if(normalized.assets.length!==expected.size||
     normalized.assets.some(record=>!files.has(record.fileName)||expected.get(record.fileName)!==record.kind))
    throw Error("Manifest does not attest the complete emitted JS/CSS inventory");
  const entryRefs=[...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"[^>]*>/g)];
  const cssRefs=[...html.matchAll(/<link\b[^>]*\bhref="([^"]+)"[^>]*>/g)];
  if(entryRefs.length!==1||entryRefs[0][1]!=="/"+entry||
     cssRefs.length!==1||cssRefs[0][1]!=="/assets/zaakiy-styles.css")
    throw Error("Invalid production HTML asset references");
  const normalizedHtml=html.replace('src="/'+entry+'"','src="/assets/ENTRY.js"');
  const normalizedManifest={...normalized,assets:normalized.assets.map(record=>
    record.fileName===entry?{...record,fileName:"assets/ENTRY.js"}:record)
    .sort((a,b)=>a.fileName.localeCompare(b.fileName))};
  return {
    entry,
    entrySha256:digest(files.get(entry)),
    cssSha256:digest(css),
    htmlSha256:digest(normalizedHtml),
    manifestSha256:digest(JSON.stringify(normalizedManifest)),
    inventory:assets.map(item=>({name:item.name,sha256:digest(item.content),
      rawBytes:Buffer.byteLength(item.content),gzipBytes:gzipSync(item.content).length}))
  };
}

const SHA=/^[a-f0-9]{64}$/;
const finite=value=>Number.isFinite(value)&&value>=0;
const percentile=(values,q)=>{
  const sorted=[...values].sort((a,b)=>a-b),x=(sorted.length-1)*q;
  return sorted[Math.floor(x)]+(sorted[Math.ceil(x)]-sorted[Math.floor(x)])*(x-Math.floor(x));
};
export function validateComparison(frozen,candidate,mode="strict"){
  if(!["strict","reviewed-runtime-delta"].includes(mode))throw Error("Unknown B8 comparison mode");
  if(frozen.schemaVersion!==2||candidate.schemaVersion!==2||
    frozen.node!==candidate.node||frozen.scenarios.length!==3||candidate.scenarios.length!==3)
    throw Error("Missing or inconsistent B8 evidence");
  return [1,8,24].map((modules,i)=>{
    const b=frozen.scenarios[i],c=candidate.scenarios[i];
    for(const r of [b,c]){
      if(r.modules!==modules||r.samples!==4||r.warmups!==1||
        ![r.assetSha256,r.semanticAssetSha256,r.fixtureSha256,r.compilerSha256,
          r.production?.entrySha256,r.production?.cssSha256,r.production?.htmlSha256,
          r.production?.manifestSha256,r.browser?.sha256].every(x=>typeof x==="string"&&SHA.test(x))||
        ![r.p50_ms,r.p95_ms,r.transformP50_ms,r.cssGenerationP50_ms,r.appJsCssGzipBytes].every(finite)||
        r.samples_ms.length!==4||!r.samples_ms.every(finite)||
        Math.abs(percentile(r.samples_ms,.5)-r.p50_ms)>1e-8||
        Math.abs(percentile(r.samples_ms,.95)-r.p95_ms)>1e-8||
        r.profiles.length!==4||r.transformCalls.length!==4||r.cssGenerationCalls.length!==4||
        r.transformCalls.some(count=>count!==modules)||r.cssGenerationCalls.some(count=>count!==1)||
        r.profiles.some(p=>p.transformCalls!==modules||p.cssGenerateCalls!==1||
          !finite(p.transformMs)||!finite(p.cssGenerateMs)||
          p.compiled.length!==modules||digest(JSON.stringify(p.compiled))!==r.compilerSha256)||
        r.browser.status!=="passed"||digest(JSON.stringify(r.browser.evidence))!==r.browser.sha256||
        r.browser.evidence.count!==modules||r.browser.evidence.identity!==true||
        JSON.stringify(r.browser.evidence.mutations)!=="[1,1]")
        throw Error("Invalid B8 instrumentation or browser evidence for "+modules);
      const inventory=r.production.inventory;
      if(inventory.length!==4||new Set(inventory.map(x=>x.name)).size!==4||
        inventory.some(x=>!SHA.test(x.sha256)||!finite(x.rawBytes)||!finite(x.gzipBytes))||
        inventory.find(x=>x.name===r.production.entry)?.sha256!==r.production.entrySha256||
        inventory.find(x=>x.name==="assets/zaakiy-styles.css")?.sha256!==r.production.cssSha256||
        inventory.filter(x=>/\.(js|css)$/.test(x.name)).reduce((sum,x)=>sum+x.gzipBytes,0)!==r.appJsCssGzipBytes)
        throw Error("Invalid B8 asset inventory");
    }
    for(const key of ["fixtureSha256","compilerSha256"])
      if(b[key]!==c[key])throw Error("B8 "+key+" differs at "+modules);
    for(const key of ["cssSha256","htmlSha256","manifestSha256"])
      if(b.production[key]!==c.production[key])throw Error("B8 "+key+" differs at "+modules);
    if(b.browser.sha256!==c.browser.sha256)throw Error("B8 native behavior differs at "+modules);
    if(mode==="strict"&&(b.semanticAssetSha256!==c.semanticAssetSha256||
      b.appJsCssGzipBytes!==c.appJsCssGzipBytes))
      throw Error("B8 production assets differ in strict mode");
    return {modules,fixtureSha256:c.fixtureSha256,compilerSha256:c.compilerSha256,
      browserSha256:c.browser.sha256,baselineAssetSha256:b.assetSha256,candidateAssetSha256:c.assetSha256,
      baselineEntrySha256:b.production.entrySha256,candidateEntrySha256:c.production.entrySha256,
      baselineGzipBytes:b.appJsCssGzipBytes,candidateGzipBytes:c.appJsCssGzipBytes,
      gzipDeltaBytes:c.appJsCssGzipBytes-b.appJsCssGzipBytes,
      baselineP50Ms:b.p50_ms,candidateP50Ms:c.p50_ms};
  });
}
