import test from "node:test";
import assert from "node:assert/strict";
import { classify, combine, makePlan, ordered, tagFor } from "./version-policy.mjs";
const sha="a".repeat(40), sig="@zaakiyjs/signals", core="@zaakiyjs/core", http="@zaakiyjs/http";
const pkgs=(v="1.2.3")=>({
  [sig]:{name:sig,version:v},
  [core]:{name:core,version:v,dependencies:{[sig]:"workspace:^"}},
  [http]:{name:http,version:v}
});
const stable=(p)=>({stable:Object.fromEntries(Object.entries(p).map(([n,v])=>[n,v.version])),channel:"stable"});
const plan=(p,intents,opts={})=>makePlan({packages:p,previous:stable(p),intents,channel:"stable",sourceSha:sha,...opts});
test("custom PR taxonomy and no-release policy",()=>{
  const p=pkgs(), paths=["packages/signals/src/signal.ts"];
  assert.deepEqual(classify("feat(signals): public API",paths,p),{[sig]:"major"});
  assert.deepEqual(classify("change: additive API",paths,p),{[sig]:"minor"});
  assert.deepEqual(classify("fix: repair",paths,p),{[sig]:"patch"});
  assert.deepEqual(classify("docs: clarify",["packages/core/README.md"],p),{});
  assert.throws(()=>classify("chore: hidden change",paths,p));
  assert.throws(()=>classify("fix!: breaking",paths,p));
  assert.throws(()=>classify("release: unauthorized",paths,p));
  assert.throws(()=>classify("constructor: invalid",paths,p));
  assert.deepEqual(combine([{[sig]:"patch"},{[sig]:"major"},{[sig]:"minor",[http]:"patch"}]),{[sig]:"major",[http]:"patch"});
});
test("stable major/minor/patch independent versions; incompatible dependent patch",()=>{
  const p=pkgs();
  assert.deepEqual(plan(p,{[sig]:"major"}).releases.map(x=>[x.name,x.version]),[[sig,"2.0.0"],[core,"1.2.4"]]);
  assert.deepEqual(plan(p,{[sig]:"minor"}).releases.map(x=>[x.name,x.version]),[[sig,"1.3.0"]]);
  assert.deepEqual(plan(p,{[sig]:"patch"}).releases.map(x=>[x.name,x.version]),[[sig,"1.2.4"]]);
  assert.equal(tagFor("stable"),"latest");
});
test("0.x minor is incompatible with previous caret",()=>{
  assert.deepEqual(plan(pkgs("0.1.0"),{[sig]:"minor"}).releases.map(x=>[x.name,x.version]),[[sig,"0.2.0"],[core,"0.1.1"]]);
});
test("bootstrap, prerelease counter, breaking target escalation, and promotions",()=>{
  const p=pkgs("0.0.0"), b=makePlan({packages:p,mode:"bootstrap",channel:"beta",sourceSha:sha});
  assert.equal(b.releases.length,3);
  assert.ok(b.releases.every(x=>x.version==="0.1.0-beta.0"));
  const pre=pkgs("0.1.0-beta.0");
  const fix=plan(pre,{[sig]:"patch"},{previous:b,channel:"beta"});
  assert.equal(fix.releases[0].version,"0.1.0-beta.1");
  assert.equal(plan(pre,{[sig]:"major"},{previous:b,channel:"beta"}).releases[0].version,"1.0.0-beta.0");
  assert.throws(()=>plan(pre,{[sig]:"patch"},{previous:b,channel:"alpha"}));
  const gamma=plan(pre,{}, {previous:b,mode:"promote",channel:"gamma"});
  assert.ok(gamma.releases.every(x=>x.version==="0.1.0-gamma.0"));
  const rc=plan(pkgs("0.1.0-gamma.0"),{}, {previous:gamma,mode:"promote",channel:"rc"});
  assert.ok(rc.releases.every(x=>x.version==="0.1.0-rc.0"));
  const done=plan(pkgs("0.1.0-rc.0"),{}, {previous:rc,mode:"promote",channel:"stable"});
  assert.ok(done.releases.every(x=>x.version==="0.1.0" && x.tag==="latest"));
  assert.throws(()=>plan(pre,{}, {previous:b,mode:"promote",channel:"alpha"}));
  assert.throws(()=>plan(pre,{[sig]:"patch"}, {previous:b,mode:"promote",channel:"rc"}));
});
test("prerelease from stable cannot contaminate stable consumer",()=>{
  const p=pkgs(), b=plan(p,{[sig]:"patch"},{channel:"alpha"});
  assert.deepEqual(b.releases.map(x=>[x.name,x.version]),[[sig,"1.2.4-alpha.0"],[core,"1.2.4-alpha.0"]]);
  const q=pkgs();q[sig].version="1.2.4-alpha.0";
  assert.throws(()=>plan(q,{[core]:"patch"},{previous:b,channel:"stable"}));
});
test("dependency order, unknown range and cycle fail closed",()=>{
  const p=pkgs();assert.ok(ordered(p).indexOf(sig)<ordered(p).indexOf(core));
  p[sig].dependencies={[core]:"workspace:^"};assert.throws(()=>ordered(p));
  const q=pkgs();q[core].dependencies={[sig]:"workspace:*"};assert.throws(()=>ordered(q));
});
