/** Strict inventory for a common real-SSR hydration matrix.
 * Records exact bundled JS/CSS sizes, compiler identities and resolved npm graphs.
 * The report is INVALID unless all 4 frameworks and 3 list sizes are present.
 */
import {resolve,join,relative,dirname} from "node:path";
import {readFile,writeFile,readdir,stat} from "node:fs/promises";
import {gzipSync,brotliCompressSync} from "node:zlib";
import {createHash} from "node:crypto";

const site=resolve(process.env.H4_SITE??"benchmark-artifacts/h4-hydration-sites");
const variants=["zaakiyjs","react","vue","angular"];
const sizes=[100,1000,10000];
const sha=bytes=>createHash("sha256").update(bytes).digest("hex");
const stats=bytes=>({raw:bytes.length,gzip:gzipSync(bytes,{level:9}).length,
  brotli:brotliCompressSync(bytes).length,sha256:sha(bytes)});
async function files(dir){
  const result=[];
  for(const e of await readdir(dir,{withFileTypes:true})){
    const name=join(dir,e.name);
    if(e.isDirectory()) result.push(...await files(name));
    else if(e.isFile()) result.push(name);
  }
  return result;
}
async function lock(path){
  const data=await readFile(path);
  const json=JSON.parse(data.toString("utf8"));
  if(json.lockfileVersion!==3 || !json.packages)
    throw Error("Require npm v3 dependency lock: "+path);
  return {sha256:sha(data),packages:Object.fromEntries(
    Object.entries(json.packages).filter(([name])=>name.startsWith("node_modules/"))
      .map(([name,pkg])=>[name.slice("node_modules/".length),pkg.version]))
  };
}
const referenceLock=await lock(join(site,"reference-generated-lock.json"));
const angularLock=await lock(join(site,"angular-generated-lock.json"));
const report={
  schema:"zaakiy.h4-reference-build/1",
  commit:process.env.GITHUB_SHA??"UNVERIFIED_LOCAL_HEAD",
  node:process.version,
  generatedAt:new Date().toISOString(),
  locks:{reference:referenceLock.sha256,angular:angularLock.sha256},
  variants:{}
};
for(const framework of variants){
  const dir=join(site,framework);
  const html={};
  for(const size of sizes){
    const file=join(dir,String(size),"index.html");
    const bytes=await readFile(file);
    if(!bytes.includes(Buffer.from("data-key")))
      throw Error("Not a pre-rendered native keyed list: "+file);
    html[size]=stats(bytes);
  }
  const bundleDir=framework==="angular"?dir:site;
  const assets=(await files(bundleDir)).filter(file=>
    file.endsWith(".js")||file.endsWith(".css"))
    .filter(file=>framework==="angular"||
      relative(site,file).startsWith(framework+"."));
  if(!assets.length) throw Error("Production browser bundle missing: "+framework);
  const outputs={};
  const totals={raw:0,gzip:0,brotli:0};
  for(const file of assets){
    const size=stats(await readFile(file));
    outputs[relative(site,file)]=size;
    for(const format of Object.keys(totals)) totals[format]+=size[format];
  }
  report.variants[framework]={
    source:framework==="zaakiyjs"?"PR H4 v2 compiler SSR":framework==="angular"?
      "Angular AOT prerender + provideClientHydration":"native SSR + client hydration",
    html,assets:outputs,bundleBytes:totals,
    dependencies:framework==="angular"?{
      angular:angularLock.packages["@angular/core"],
      angularSsr:angularLock.packages["@angular/ssr"],
      compiler:angularLock.packages["@angular/compiler-cli"]
    }:framework==="react"?{
      react:referenceLock.packages.react,
      reactDom:referenceLock.packages["react-dom"]
    }:framework==="vue"?{
      vue:referenceLock.packages.vue,
      vueSsr:referenceLock.packages["@vue/server-renderer"]
    }:{}
  };
}
if(Object.keys(report.variants).length!==4) throw Error("Incomplete H4 matrix");
await writeFile(join(site,"build-manifest.json"),JSON.stringify(report,null,2)+"\n");
console.log(JSON.stringify({commit:report.commit,versions:Object.fromEntries(
  Object.entries(report.variants).map(([name,v])=>[name,v.dependencies])),
  transferred:Object.fromEntries(Object.entries(report.variants).map(([name,v])=>[name,v.bundleBytes]))}));
