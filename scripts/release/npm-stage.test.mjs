import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { validateArtifacts } from "./npm-stage.mjs";
const sha="a".repeat(40), name="@zaakiyjs/signals";
function fixture(fn){
  const dir=mkdtempSync(join(tmpdir(),"zaakiy-stage-test-"));
  try{
    mkdirSync(join(dir,"package"));
    const pkg={name,version:"0.1.0-beta.0",license:"MIT",publishConfig:{access:"public"}};
    writeFileSync(join(dir,"package","package.json"),JSON.stringify(pkg));
    const filename="zaakiyjs-signals-0.1.0-beta.0.tgz", path=join(dir,filename);
    execFileSync("tar",["-czf",path,"-C",dir,"package"]);
    const bytes=readFileSync(path);
    const plan={schema:"zaakiy.release/1",channel:"beta",releases:[{name,version:pkg.version,tag:"beta"}]};
    const report={validated:true,licenseApproved:true,packedConsumption:true,releaseBlockers:[],licenseFilesVerified:1,internalPackageCount:1,archives:{[name]:{filename,sha256:createHash("sha256").update(bytes).digest("hex"),integrity:"sha512-"+createHash("sha512").update(bytes).digest("base64")}}};
    fn({dir,path,plan,report});
  }finally{rmSync(dir,{recursive:true,force:true});}
}
test("only certified exact tarball with explicit channel is accepted",()=>fixture(({dir,plan,report})=>{
  const out=validateArtifacts(plan,report,dir,sha);
  assert.equal(out.length,1);assert.equal(out[0].tag,"beta");
  assert.equal(out[0].integrity,report.archives[name].integrity);
}));
test("tampered bytes and invalid certification fail closed",()=>fixture(({dir,path,plan,report})=>{
  report.releaseBlockers=["unresolved"];assert.throws(()=>validateArtifacts(plan,report,dir,sha));
  report.releaseBlockers=[];writeFileSync(path,"tampered");
  assert.throws(()=>validateArtifacts(plan,report,dir,sha),/digest mismatch/);
}));
test("duplicate package, incorrect dist tag, and archive traversal rejected",()=>fixture(({dir,plan,report})=>{
  plan.releases.push({...plan.releases[0]});assert.throws(()=>validateArtifacts(plan,report,dir,sha),/duplicate/);
  plan.releases.pop();plan.releases[0].tag="latest";assert.throws(()=>validateArtifacts(plan,report,dir,sha));
  plan.releases[0].tag="beta";report.archives[name].filename="../unsafe.tgz";
  assert.throws(()=>validateArtifacts(plan,report,dir,sha),/safe archive/);
}));
