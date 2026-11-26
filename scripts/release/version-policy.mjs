import semver from "semver";
import { readFileSync, readdirSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const channels = ["alpha", "beta", "gamma", "rc", "stable"];
export const bumpByPrefix = Object.freeze({feat:"major", change:"minor", fix:"patch"});
const ranks = {patch:1, minor:2, major:3};
const noRelease = new Set(["docs","test","chore","ci","build","perf","refactor"]);
const prefix = /^([a-z]+)(?:\([a-z0-9-]+\))?(!)?:\s+\S/;
const scope = "@zaakiyjs/";
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const max = (a,b) => !a || ranks[b] > ranks[a] ? b : a;
const core = v => semver.parse(v).version.split("-")[0];
const channelOf = v => semver.prerelease(v)?.[0] ?? "stable";
export const tagFor = channel => channel === "stable" ? "latest" : channel;
export function manifests(root = ".") {
  return Object.fromEntries(readdirSync(join(root,"packages"),{withFileTypes:true})
    .filter(e=>e.isDirectory() && existsSync(join(root,"packages",e.name,"package.json")))
    .map(e=>{const p=JSON.parse(readFileSync(join(root,"packages",e.name,"package.json"),"utf8"));
      assert(p.name===scope+e.name && !p.private && semver.valid(p.version), "Invalid publishable package "+e.name);
      return [p.name,p];}).sort(([a],[b])=>a.localeCompare(b)));
}
export function packageChanges(paths, packages) {
  const known = new Set(Object.keys(packages));
  const found = new Set();
  for (const path of paths) {
    const m = /^packages\/([^/]+)\/(.+)$/.exec(path);
    if (!m) continue;
    const name=scope+m[1], file=m[2];
    if (/^(?:README(?:\.md)?|LICENSE|CHANGELOG\.md|docs\/|tests?\/|__tests__\/)/.test(file) ||
        /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(file)) continue;
    assert(known.has(name),"Unknown or removed package "+name+"; requires explicit release policy review");
    found.add(name);
  }
  return [...found].sort();
}
export function releaseMetadataOnly(paths) {
  return paths.includes(".release/manifest.json") && paths.every(p=>p===".release/manifest.json" ||
    /^packages\/[^/]+\/(?:package\.json|CHANGELOG\.md)$/.test(p));
}
export function classify(title, paths, packages) {
  const match=prefix.exec(title);
  assert(match,"PR title must use feat:, change:, fix:, docs:, chore:, ci:, test:, build:, perf:, refactor: or release:");
  const type=match[1], affected=packageChanges(paths,packages);
  if(type==="release") {
    assert(releaseMetadataOnly(paths),"release: PRs may only contain generated release metadata");
    return {};
  }
  const bump=Object.hasOwn(bumpByPrefix,type)?bumpByPrefix[type]:undefined;
  if(bump){
    assert(!match[2] || bump==="major","Breaking changes must use feat!: under ZaakiyJS policy");
    assert(affected.length,"Release PR title requires changed publishable package files");
    return Object.fromEntries(affected.map(name=>[name,bump]));
  }
  assert(noRelease.has(type) && !match[2],"Unknown or invalid non-release PR title");
  assert(!affected.length,"Package changes require feat:, change: or fix:");
  return {};
}
function dependencies(p, packages) {
  const entries = Object.entries({...p.dependencies,...p.optionalDependencies,...p.peerDependencies})
    .filter(([n])=>n.startsWith(scope));
  for(const [n,range] of entries) assert(packages[n] && range==="workspace:^","Unsupported internal dependency range: "+p.name+" -> "+n);
  return entries.map(([n])=>n).sort();
}
export function ordered(packages) {
  const done=new Set(), active=new Set(), order=[];
  function visit(n) {
    if(done.has(n)) return;
    assert(!active.has(n),"Dependency cycle: "+n);
    active.add(n); dependencies(packages[n],packages).forEach(visit);
    active.delete(n); done.add(n); order.push(n);
  }
  Object.keys(packages).sort().forEach(visit);
  return order;
}
function nextVersion(old, stable, bump, channel) {
  assert(Object.hasOwn(ranks,bump) && semver.valid(stable) && !semver.prerelease(stable),"Invalid version intent");
  const target=semver.inc(stable,bump);
  if(semver.prerelease(old)){
    const base=semver.gt(target,core(old))?target:core(old);
    assert(channelOf(old)===channel,"Use explicit promotion to change an active prerelease channel");
    return base===core(old)?semver.inc(old,"prerelease",channel):base+"-"+channel+".0";
  }
  const base=semver.inc(old,bump);
  return channel==="stable"?base:base+"-"+channel+".0";
}
export function makePlan({packages, previous, intents={}, mode="changes", channel="beta", sourceSha, sources=[]}) {
  assert(channels.includes(channel) && ["bootstrap","changes","promote"].includes(mode),"Invalid mode/channel");
  assert(/^[a-f0-9]{40}$/.test(sourceSha),"Invalid source SHA");
  const order=ordered(packages), versions=Object.fromEntries(order.map(n=>[n,packages[n].version]));
  const stable=Object.fromEntries(order.map(n=>[n,previous?.stable?.[n] ?? (semver.prerelease(versions[n])?null:versions[n])]));
  const changes={}, reasons={};
  for(const n of order) assert(stable[n] && semver.valid(stable[n]) && !semver.prerelease(stable[n]),"Missing stable baseline for "+n);
  function add(n,version,bump,reason){
    assert(semver.valid(version) && semver.gt(version,versions[n]),"Non-increasing release for "+n);
    changes[n]={name:n,from:versions[n],version,bump,tag:tagFor(channel)};
    (reasons[n]??=new Set()).add(reason);
  }
  if(mode==="bootstrap"){
    assert(!previous && order.every(n=>versions[n]==="0.0.0") && channel!=="stable","Bootstrap requires all placeholder versions and a prerelease channel");
    order.forEach(n=>add(n,"0.1.0-"+channel+".0","minor","Initial public prerelease"));
  }else{
    assert(previous && order.every(n=>versions[n]!=="0.0.0"),"Complete first release preparation before incremental releases");
    if(mode==="promote"){
      assert(!Object.keys(intents).length,"Prepare outstanding changes before channel promotion");
      for(const n of order){
        const old=versions[n]; if(!semver.prerelease(old)) continue;
        assert(channels.indexOf(channel)>channels.indexOf(channelOf(old)),"Promotion must move forward");
        add(n,channel==="stable"?core(old):core(old)+"-"+channel+".0","promotion","Approved channel promotion");
      }
    }else{
      assert(order.every(n=>!semver.prerelease(versions[n]) || channelOf(versions[n])===channel),"Promote the active prerelease train before switching channels");
      assert(sources.every(s=>!s.channel || s.channel===channel),"Merged PR channel labels conflict with requested release channel");
      for(const [n,bump] of Object.entries(intents)){
        assert(Object.hasOwn(packages,n) && Object.hasOwn(ranks,bump),"Invalid release intent "+n);
        add(n,nextVersion(versions[n],stable[n],bump,channel),bump,"Merged PR change");
      }
    }
    // Traverse dependency-first; a release is necessary only for an incompatible packed caret range.
    for(const n of order){
      for(const dep of dependencies(packages[n],packages)){
        if(!changes[dep]) continue;
        const newDep=changes[dep].version;
        if(!changes[n] && !semver.satisfies(newDep,"^"+versions[dep])){
          add(n,nextVersion(versions[n],stable[n],"patch",channel),"patch","Dependency range update: "+dep);
        }else if(changes[n]) (reasons[n]??=new Set()).add("Dependency: "+dep);
      }
    }
  }
  for(const n of order){
    if(!changes[n]) continue;
    if(channel==="stable"){
      for(const dep of dependencies(packages[n],packages))
        assert(!semver.prerelease(changes[dep]?.version??versions[dep]),"Stable release cannot consume prerelease dependency: "+dep);
      stable[n]=changes[n].version;
    }
    changes[n].reasons=[...reasons[n]].sort();
  }
  const releases=order.filter(n=>changes[n]).map(n=>changes[n]);
  return {schema:"zaakiy.release/1",sourceSha,mode,channel,stable,sources,releases};
}
export function combine(intents) {
  const result={};
  for(const intent of intents) for(const [n,b] of Object.entries(intent)) result[n]=max(result[n],b);
  return result;
}
const git=(args)=>execFileSync("git",args,{encoding:"utf8"}).trim();
export function changedPaths(base,head) {
  assert(/^[a-f0-9]{40}$/.test(base)&&/^[a-f0-9]{40}$/.test(head),"Invalid comparison SHA");
  return execFileSync("git",["diff","--name-only","--no-renames","-z",base,head],{encoding:"utf8"}).split("\0").filter(Boolean);
}
const statePath=".release/manifest.json";
function prior(){return existsSync(statePath)?JSON.parse(readFileSync(statePath,"utf8")):null;}
function writePlan(plan,packages) {
  assert(plan.releases.length,"No publishable changes found");
  for(const r of plan.releases){
    const name=r.name.slice(scope.length), dir=join("packages",name), p=packages[r.name];
    assert(p.version===r.from,"Package version changed during preparation");
    p.version=r.version;
    p.repository={type:"git",url:"https://github.com/sanukhandev/zaakiyjs.git",directory:"packages/"+name};
    p.homepage="https://github.com/sanukhandev/zaakiyjs";
    p.bugs={url:"https://github.com/sanukhandev/zaakiyjs/issues"};
    writeFileSync(join(dir,"package.json"),JSON.stringify(p,null,2)+"\n");
    const changelog=join(dir,"CHANGELOG.md"), old=existsSync(changelog)?readFileSync(changelog,"utf8"):"";
    writeFileSync(changelog,"# "+r.name+" "+r.version+"\n\n"+r.reasons.map(x=>"- "+x).join("\n")+"\n- Source: "+plan.sourceSha+"\n\n"+old);
  }
  mkdirSync(".release",{recursive:true});writeFileSync(statePath,JSON.stringify(plan,null,2)+"\n");
}
function verifyReleasePR(paths, base, packages) {
  const plan=prior();assert(plan?.schema==="zaakiy.release/1" && plan.sourceSha===base && plan.releases.length,"Release PR must be generated against current main");
  assert(channels.includes(plan.channel),"Invalid release channel");
  const basePackages=Object.fromEntries(Object.keys(packages).map(n=>[n,JSON.parse(git(["show",base+":packages/"+n.slice(scope.length)+"/package.json"]))]));
  const expectedPaths=[".release/manifest.json",...plan.releases.flatMap(r=>["packages/"+r.name.slice(scope.length)+"/package.json","packages/"+r.name.slice(scope.length)+"/CHANGELOG.md"])].sort();
  assert(JSON.stringify([...paths].sort())===JSON.stringify(expectedPaths),"Release PR file set does not match manifest");
  assert(new Set(plan.releases.map(r=>r.name)).size===plan.releases.length,"Duplicate release package");
  const oldPlan=(()=>{try{return JSON.parse(git(["show",base+":"+statePath]));}catch{return null;}})();
  const sources=plan.mode==="bootstrap"?[]:mergedSources(oldPlan.sourceSha,base,basePackages);
  assert(JSON.stringify(sources)===JSON.stringify(plan.sources),"Release source PRs do not match merged main history");
  const expected=makePlan({packages:basePackages,previous:oldPlan,intents:combine(sources.map(s=>s.intent)),mode:plan.mode,channel:plan.channel,sourceSha:base,sources});
  assert(JSON.stringify(expected)===JSON.stringify(plan),"Release manifest does not match computed versions");
  for(const [n,p] of Object.entries(packages)){
    const r=plan.releases.find(r=>r.name===n), old=basePackages[n];
    if(r){old.version=r.version;old.repository={type:"git",url:"https://github.com/sanukhandev/zaakiyjs.git",directory:"packages/"+n.slice(scope.length)};old.homepage="https://github.com/sanukhandev/zaakiyjs";old.bugs={url:"https://github.com/sanukhandev/zaakiyjs/issues"};}
    assert(JSON.stringify(p)===JSON.stringify(old),"Unexpected package manifest mutation: "+n);
  }
  return plan;
}
function mergedSources(base,head,packages){
  // First-parent history supports merge and squash commits, rejects ambiguous/direct pushes.
  const commits=git(["rev-list","--first-parent","--reverse",base+".."+head]).split("\n").filter(Boolean);
  const out=[];
  for(const sha of commits){
    const prs=JSON.parse(execFileSync("gh",["api","repos/sanukhandev/zaakiyjs/commits/"+sha+"/pulls"],{encoding:"utf8"}));
    const exact=prs.filter(p=>p.merged_at && p.merge_commit_sha===sha && p.base.ref==="main");
    assert(exact.length===1,"Commit is not an unambiguous merged main PR: "+sha);
    const p=exact[0], parent=git(["rev-parse",sha+"^1"]), paths=changedPaths(parent,sha);
    const intent=classify(p.title,paths,packages);
    if(Object.keys(intent).length) {
      const labels=p.labels.filter(l=>l.name.startsWith("release-channel:")).map(l=>l.name.slice("release-channel:".length));
      assert(labels.length<=1 && labels.every(c=>channels.includes(c)),"Invalid channel labels on merged PR "+p.number);
      out.push({number:p.number,sha,title:p.title,intent,...(labels.length?{channel:labels[0]}:{})});
    }
  }
  return out;
}
function main(){
  const command=process.argv[2], packages=manifests();
  if(command==="preview"){
    const event=JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH,"utf8")), pr=event.pull_request;
    const base=pr.base.sha, head=git(["rev-parse","HEAD"]), paths=changedPaths(base,head);
    if(prefix.exec(pr.title)?.[1]==="release"){
      assert(releaseMetadataOnly(paths),"Invalid release PR");console.log(JSON.stringify(verifyReleasePR(paths,base,packages),null,2));return;
    }
    assert(!paths.includes(statePath),"Only generated release PRs may modify the release manifest");
    for(const n of Object.keys(packages)){
      const old=JSON.parse(git(["show",base+":packages/"+n.slice(scope.length)+"/package.json"]));
      assert(old.version===packages[n].version,"Versions may only change in a generated release PR");
    }
    const intents=classify(pr.title,paths,packages), previous=prior();
    const requested=pr.labels.filter(l=>l.name.startsWith("release-channel:")).map(l=>l.name.slice("release-channel:".length));
    assert(requested.length<=1 && requested.every(c=>channels.includes(c)),"Select at most one valid release-channel label");
    const channel=requested[0]??previous?.channel??"beta";
    console.log(JSON.stringify({intents,bootstrapRequired:!previous,plan:previous?makePlan({packages,previous,intents,channel,sourceSha:head}):null},null,2));
  }else if(command==="prepare"){
    const mode=process.env.RELEASE_MODE,channel=process.env.RELEASE_CHANNEL,head=git(["rev-parse","HEAD"]),previous=prior();
    assert(mode==="bootstrap" || previous,"Bootstrap the initial release first");
    const sources=mode==="bootstrap"?[]:mergedSources(previous.sourceSha,head,packages);
    const plan=makePlan({packages,previous,intents:combine(sources.map(s=>s.intent)),mode,channel,sourceSha:head,sources});
    writePlan(plan,packages);console.log(JSON.stringify(plan,null,2));
  }else throw new Error("Expected preview or prepare");
}
if(process.argv[1] && fileURLToPath(import.meta.url)===process.argv[1]) main();
