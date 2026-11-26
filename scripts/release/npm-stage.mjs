import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const assert=(condition,message)=>{if(!condition)throw new Error(message);};
export function validateArtifacts(plan,report,dir,expectedSha){
  assert(/^[a-f0-9]{40}$/.test(expectedSha),"Invalid release SHA");
  assert(plan.schema==="zaakiy.release/1" && report.validated && report.licenseApproved &&
    report.releaseBlockers.length===0 && report.packedConsumption && report.licenseFilesVerified===report.internalPackageCount,
    "Strict packed-consumer certification required");
  const selected=new Set(), result=[];
  const tag=plan.channel==="stable"?"latest":plan.channel;
  assert(["alpha","beta","gamma","rc","latest"].includes(tag),"Unknown release channel");
  for(const release of plan.releases){
    const {name,version}=release, artifact=report.archives?.[name];
    assert(/^@zaakiyjs\/[a-z0-9-]+$/.test(name) && /^\d+\.\d+\.\d+(?:-(?:alpha|beta|gamma|rc)\.\d+)?$/.test(version) &&
      !selected.has(name) && release.tag===tag && (tag==="latest"?!version.includes("-"):version.includes("-"+tag+".")),
      "Invalid or duplicate release: "+name);
    assert(artifact && /^[a-zA-Z0-9.-]+\.tgz$/.test(artifact.filename) && !artifact.filename.startsWith("."),"Missing safe archive filename for "+name);
    const path=join(dir,artifact.filename), bytes=readFileSync(path);
    assert(createHash("sha256").update(bytes).digest("hex")===artifact.sha256 &&
      "sha512-"+createHash("sha512").update(bytes).digest("base64")===artifact.integrity,"Artifact digest mismatch: "+name);
    const p=JSON.parse(execFileSync("tar",["-xOzf",path,"package/package.json"],{encoding:"utf8"}));
    assert(p.name===name && p.version===version && p.license==="MIT" && p.publishConfig?.access==="public","Packed manifest mismatch: "+name);
    selected.add(name);result.push({name,version,tag,path,integrity:artifact.integrity,dependencies:{...p.dependencies,...p.optionalDependencies,...p.peerDependencies}});
  }
  assert(result.length>0,"Empty publication plan");
  const index=new Map(result.map((p,i)=>[p.name,i]));
  for(const [i,p] of result.entries()){
    p.internalDependencies=[];
    for(const [dep,range] of Object.entries(p.dependencies)){
      if(!dep.startsWith("@zaakiyjs/"))continue;
      assert(/^@zaakiyjs\/[a-z0-9-]+$/.test(dep),"Unsafe dependency name");
      const manifest=JSON.parse(readFileSync(join("packages",dep.slice("@zaakiyjs/".length),"package.json"),"utf8"));
      assert(range==="^"+manifest.version,"Packed dependency range differs from workspace: "+p.name+" -> "+dep);
      if(index.has(dep))assert(index.get(dep)<i && result[index.get(dep)].version===manifest.version,"Dependency order/version mismatch "+p.name+" -> "+dep);
      else p.internalDependencies.push({name:dep,version:manifest.version});
    }
  }
  return result;
}
const npm=(args)=>execFileSync("npm",args,{encoding:"utf8",stdio:["ignore","pipe","pipe"]});
function registryIntegrity(p){
  const r=spawnSync("npm",["view",p.name+"@"+p.version,"dist.integrity","--json","--registry=https://registry.npmjs.org/"],{encoding:"utf8"});
  if(r.status===0){
    assert(r.stdout.trim(),"Registry returned no integrity for "+p.name);
    return JSON.parse(r.stdout);
  }
  if(r.stderr.includes("E404") || r.stdout.includes('"code": "E404"'))return null;
  throw new Error("Registry lookup failed for "+p.name+"; stop and review");
}
function main(){
  const mode=process.argv[2], dir=process.argv[3], expected=process.env.RELEASE_SHA;
  assert(["dry-run","stage","verify"].includes(mode) && dir,"Expected dry-run, stage or verify and artifact directory");
  assert(execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim()===expected,"Wrong source commit");
  const plan=JSON.parse(readFileSync(".release/manifest.json","utf8"));
  const report=JSON.parse(readFileSync(join(dir,"packed-consumer-report.json"),"utf8"));
  const selected=validateArtifacts(plan,report,join(dir,"archives"),expected);
  if(mode==="stage"){
    assert(process.env.NPM_STAGE_AUTHORIZED==="true","Staging not authorized");
    // Entire plan preflight before any registry mutation. No automatic retries.
    const required=new Map();
    for(const p of selected){
      assert(!registryIntegrity(p),"Version already published; reconcile before staging: "+p.name);
      for(const dep of p.internalDependencies)required.set(dep.name+"@"+dep.version,dep);
    }
    for(const dep of required.values())assert(registryIntegrity(dep),"Required internal version not on registry: "+dep.name+"@"+dep.version);
  }
  for(const p of selected){
    if(mode==="dry-run"){console.log("READY "+p.name+"@"+p.version+" tag="+p.tag);continue;}
    const integrity=registryIntegrity(p);
    if(mode==="verify"){
      assert(integrity===p.integrity,"Published integrity mismatch or missing "+p.name);
      const tags=JSON.parse(npm(["view",p.name,"dist-tags","--json","--registry=https://registry.npmjs.org/"]));
      assert(tags[p.tag]===p.version,"Registry tag mismatch for "+p.name);
      console.log("VERIFIED "+p.name+"@"+p.version);
      continue;
    }
    // Never retry an uncertain staged operation or overwrite an existing version.
    assert(!integrity,"Version already published; use verify or reconcile manually: "+p.name);
    execFileSync("npm",["stage","publish",p.path,"--access","public","--tag",p.tag,"--registry=https://registry.npmjs.org/"],{stdio:"inherit"});
    console.log("STAGED "+p.name+"@"+p.version+"; maintainer approval required");
  }
}
if(process.argv[1] && fileURLToPath(import.meta.url)===process.argv[1])main();
