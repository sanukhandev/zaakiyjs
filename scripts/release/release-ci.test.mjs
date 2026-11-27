import test from "node:test";
import assert from "node:assert/strict";
import { validatePushRuns, validateCorrection, certifyRelease } from "./release-ci.mjs";

const source="a".repeat(40), release="b".repeat(40), current="c".repeat(40), prHead="d".repeat(40), correctionHead="e".repeat(40);
const workflow = name => ".github/workflows/" + name + ".yml";
const mandatory=["quality","release-hardening","production-benchmark","m1-browser-matrix","cli-generated-app-acceptance"];
const run=(name,sha=release,extra={})=>({path:workflow(name),head_sha:sha,head_branch:"main",event:"push",run_number:1,run_attempt:1,id:1,status:"completed",conclusion:"success",...extra});
const pages=runs=>[{total_count:runs.length,workflow_runs:runs}];
const good=sha=>mandatory.map(name=>run(name,sha));
test("passes all mandatory gates and reports only exact retired workflow exception",()=>{
  const result=validatePushRuns(pages([...good(release),run("h4-hydration-locks",release,{conclusion:"failure"})]),release);
  assert.equal(result.passed.length,5);
  assert.equal(result.ignored.length,1);
  assert.throws(()=>validatePushRuns(pages([...good(release),run("h4-hydration-reference",release,{conclusion:"failure"})]),release),/h4-hydration-reference/);
});
test("rejects missing, pending, failed, skipped and incomplete push evidence",()=>{
  assert.throws(()=>validatePushRuns(pages(good(release).slice(1)),release),/missing:.*quality/);
  for(const conclusion of ["failure","skipped","cancelled",null]){
    assert.throws(()=>validatePushRuns(pages([...good(release).slice(1),run("quality",release,{conclusion,status:conclusion?"completed":"in_progress"})]),release),/not passed:.*quality/);
  }
  assert.throws(()=>validatePushRuns([{total_count:6,workflow_runs:good(release)}],release),/Incomplete workflow evidence/);
  assert.throws(()=>validatePushRuns(pages(good(current)),release),/Nonmatching workflow evidence/);
});
test("selects latest run and latest attempt rather than any historical success",()=>{
  const old=run("quality",release,{run_number:1,conclusion:"failure"});
  assert.equal(validatePushRuns(pages([...good(release).slice(1),old,run("quality",release,{run_number:2})]),release).passed.length,5);
  assert.throws(()=>validatePushRuns(pages([...good(release),run("quality",release,{run_attempt:2,conclusion:"failure"})]),release),/quality/);
});
test("allow only exact reviewed CI correction paths",()=>{
  validateCorrection([workflow("npm-publish"),workflow("h4-hydration-locks"),"scripts/release/release-ci.mjs"],"ci(release): repair gate");
  for(const path of ["packages/core/src/index.ts","packages/core/package.json","pnpm-lock.yaml","package.json",".release/manifest.json",workflow("quality"),"scripts/release/verify-packages.mjs","scripts/release/npm-stage.mjs"])assert.throws(()=>validateCorrection([path],"ci: repair"),/Non-release-control/);
  assert.throws(()=>validateCorrection([workflow("npm-publish")],"fix: repair"),/Only explicitly classified/);
});
function fixture({corrected=true, changedPath=workflow("npm-publish"), title="ci(release): repair", badTree=false, failedPolicy=false, badPush=false, moved=false, wrongSource=false}={}){
  const head=corrected?current:release;
  const trees={[release]:"original-tree",[prHead]:"original-tree",[current]:"correction-tree",[correctionHead]:badTree?"wrong-tree":"correction-tree"};
  const git=args=>{
    if(args[0]==="rev-list")return (corrected?[release,current]:[release]).join("\n")+"\n";
    if(args[0]==="diff")return changedPath+"\0";
    if(args[1]==="HEAD")return head+"\n";
    if(args[1]===release+"^1")return (wrongSource?current:source)+"\n";
    if(args[1].endsWith("^{tree}"))return trees[args[1].slice(0,-7)]+"\n";
    throw Error("Unexpected git "+args.join(" "));
  };
  const api=(path,paginated)=>{
    if(path==="/branches/main")return {commit:{sha:moved?source:head}};
    if(path.endsWith("/pulls")){
      assert.equal(paginated,true);
      const orig=path.includes(release);
      return [[{number:orig?105:107,title:orig?"release: prepare beta":title,merged_at:"2026-11-27",base:{ref:"main"},merge_commit_sha:orig?release:current,head:{sha:orig?prHead:correctionHead}}]];
    }
    if(path.startsWith("/git/commits/"))return {tree:{sha:trees[path.split("/").at(-1)]}};
    const sha=path.match(/head_sha=([a-f0-9]{40})/)[1];
    if(path.includes("event=pull_request"))return pages([run("release-version-policy",sha,{event:"pull_request",conclusion:failedPolicy&&sha===correctionHead?"failure":"success"})]);
    return pages([...good(sha),...(badPush&&sha===head?[run("extra",sha,{conclusion:"failure"})]:[])]);
  };
  return {current:head,plan:{schema:"zaakiy.release/1",sourceSha:source,releases:[{name:"@zaakiyjs/core"}]},git,api};
}
test("certifies original release and exact main after metadata-only CI correction",()=>{
  const original=certifyRelease(fixture({corrected:false}));
  assert.equal(original.releaseCommit,release);assert.equal(original.corrections.length,0);assert.equal(original.push.length,1);
  const repaired=certifyRelease(fixture());
  assert.equal(repaired.releaseCommit,release);assert.equal(repaired.certificationCommit,current);assert.equal(repaired.corrections.length,1);assert.equal(repaired.push.length,2);
});
test("rejects altered inputs, unreviewed trees, failed policy, failing CI and moved main",()=>{
  for(const opts of [{changedPath:"packages/core/package.json"},{title:"fix: runtime"},{badTree:true},{failedPolicy:true},{badPush:true},{moved:true},{wrongSource:true}])assert.throws(()=>certifyRelease(fixture(opts)));
});
