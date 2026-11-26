import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,mkdirSync,rmSync,writeFileSync,readFileSync,existsSync,symlinkSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {fileURLToPath,URL} from "node:url";
import {install} from "../../.agents/skills/zaakiyjs-builder/scripts/install.mjs";
import {inspect} from "../../.agents/skills/zaakiyjs-builder/scripts/inspect.mjs";

const source=fileURLToPath(new URL("../../.agents/skills/zaakiyjs-builder/",import.meta.url));
function fixture(t){
  const root=mkdtempSync(join(tmpdir(),"zaakiy-agent-skill-"));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  return root;
}
const json=(path,object)=>writeFileSync(path,JSON.stringify(object));

test("portable metadata and supporting references are present",()=>{
  const body=readFileSync(join(source,"SKILL.md"),"utf8");
  const header=/^---\nname: ([a-z0-9-]+)\ndescription: ([^\n]+)\n---\n/.exec(body);
  assert.ok(header);
  assert.equal(header[1],"zaakiyjs-builder");
  assert.ok(header[2].length<=1024);
  for(const path of ["references/api-and-architecture.md","references/application-workflow.md","references/verification.md","scripts/inspect.mjs"])
    assert.ok(body.includes(path)&&existsSync(join(source,path)),path);
});
test("dry run never writes; all installs two canonical destinations; rerun is idempotent",t=>{
  const root=fixture(t);
  assert.deepEqual(install("all",root,true).plans.map(p=>p.action),["would-install","would-install"]);
  assert.equal(existsSync(join(root,".agents")),false);
  assert.equal(existsSync(join(root,".claude")),false);
  const installed=install("all",root);
  assert.deepEqual(installed.plans.map(p=>p.action),["install","install"]);
  for(const plan of installed.plans){
    for(const file of ["SKILL.md","references/verification.md","scripts/inspect.mjs","scripts/install.mjs"])
      assert.deepEqual(readFileSync(join(plan.destination,file)),readFileSync(join(source,file)));
  }
  assert.deepEqual(install("all",root).plans.map(p=>p.action),["unchanged","unchanged"]);
});
test("agent-specific discovery paths are correct",t=>{
  const root=fixture(t);
  assert.ok(install("codex",root).plans[0].destination.endsWith(join(".agents","skills","zaakiyjs-builder")));
  assert.equal(install("antigravity",root).plans[0].action,"unchanged");
  assert.ok(install("cursor",root).plans[0].destination.endsWith(join(".cursor","skills","zaakiyjs-builder")));
  assert.ok(install("claude",root).plans[0].destination.endsWith(join(".claude","skills","zaakiyjs-builder")));
  assert.throws(()=>install("unknown",root),/Unknown agent/);
});
test("divergent existing skills are preserved and prevent partial all installation",t=>{
  const root=fixture(t);
  const dest=join(root,".claude","skills","zaakiyjs-builder");
  mkdirSync(dest,{recursive:true});
  writeFileSync(join(dest,"SKILL.md"),"user-owned content");
  assert.throws(()=>install("all",root),/divergent/);
  assert.equal(readFileSync(join(dest,"SKILL.md"),"utf8"),"user-owned content");
  assert.equal(existsSync(join(root,".agents")),false);
});
test("symlink destinations are refused",t=>{
  const root=fixture(t),outside=fixture(t);
  symlinkSync(outside,join(root,".agents"),"junction");
  assert.throws(()=>install("codex",root),/Unsafe destination parent/);
  assert.equal(existsSync(join(outside,"skills")),false);
});
test("inspector distinguishes workspace and reports actual manifest exports",t=>{
  const root=fixture(t);
  json(join(root,"package.json"),{name:"zaakiyjs-monorepo",packageManager:"pnpm@10.20.0",scripts:{build:"tsc",test:"vitest"}});
  writeFileSync(join(root,"pnpm-workspace.yaml"),"packages:\n  - packages/*\n");
  mkdirSync(join(root,"packages","signals"),{recursive:true});
  json(join(root,"packages","signals","package.json"),{name:"@zaakiyjs/signals",version:"0.0.0",exports:{".":"./dist/index.js"}});
  const result=inspect(root);
  assert.equal(result.kind,"framework-workspace");
  assert.equal(result.packages.length,1);
  assert.equal(result.packages[0].localOnly,true);
  assert.equal(result.packages[0].exports["."],"./dist/index.js");
  assert.deepEqual(result.scripts,["build","test"]);
});
test("inspector reports missing installed declarations without pretending runtime availability",t=>{
  const root=fixture(t);
  assert.equal(inspect(root).kind,"uninitialized");
  json(join(root,"package.json"),{name:"app",dependencies:{"@zaakiyjs/core":"0.0.0"}});
  const r=inspect(root);
  assert.equal(r.kind,"zaakiyjs-application");
  assert.equal(r.packages[0].declared,"0.0.0");
  assert.equal(r.packages[0].manifestVersion,null);
  assert.equal(r.packages[0].exports,null);
  assert.equal(r.hasLockfile,false);
});
test("inspector never executes project scripts and rejects malformed manifests",t=>{
  const root=fixture(t);
  json(join(root,"package.json"),{name:"other",scripts:{build:"touch SHOULD-NOT-EXIST"}});
  assert.equal(inspect(root).kind,"other-project");
  assert.equal(existsSync(join(root,"SHOULD-NOT-EXIST")),false);
  writeFileSync(join(root,"package.json"),"not json");
  assert.throws(()=>inspect(root),SyntaxError);
});
