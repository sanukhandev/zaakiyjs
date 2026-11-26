import {lstatSync,mkdirSync,readdirSync,readFileSync,realpathSync,rmSync,writeFileSync} from "node:fs";
import {dirname,join,resolve} from "node:path";
import {fileURLToPath,pathToFileURL} from "node:url";

const source=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const skill="zaakiyjs-builder";
const locations={codex:[".agents","skills"],antigravity:[".agents","skills"],cursor:[".cursor","skills"],claude:[".claude","skills"]};
const expected=["SKILL.md","references/api-and-architecture.md","references/application-workflow.md","references/verification.md","scripts/inspect.mjs","scripts/install.mjs"];

function collect(root,prefix=""){
  const files=[];
  for(const entry of readdirSync(root,{withFileTypes:true})){
    const rel=prefix+entry.name;
    if(entry.isDirectory())files.push(...collect(join(root,entry.name),rel+"/"));
    else if(entry.isFile())files.push(rel);
    else throw Error("Refusing non-regular skill entry: "+rel);
  }
  return files.sort();
}
function statIfPresent(path){
  try{return lstatSync(path);}catch(error){if(error.code==="ENOENT")return null;throw error;}
}
function directory(path){
  const stat=statIfPresent(path);
  if(!stat||!stat.isDirectory()||stat.isSymbolicLink())throw Error("Expected real directory: "+path);
}
export function install(agent,project,dryRun=false){
  if(!Object.hasOwn(locations,agent)&&agent!=="all")throw Error("Unknown agent: "+agent);
  const projectPath=resolve(project);
  directory(projectPath);
  const target=realpathSync(projectPath);
  const files=collect(source);
  if(JSON.stringify(files)!==JSON.stringify([...expected].sort()))throw Error("Unexpected skill source inventory");
  // Shared .agents location serves Codex, current Antigravity and current Cursor.
  // Explicit Cursor-only install uses its native directory.
  const roots=agent==="all"?[locations.codex,locations.claude]:[locations[agent]];
  const plans=[];
  for(const parts of roots){
    let parent=target;
    for(const part of parts){
      parent=join(parent,part);
      const stat=statIfPresent(parent);
      if(stat&&(!stat.isDirectory()||stat.isSymbolicLink()))throw Error("Unsafe destination parent: "+parent);
    }
    const destination=join(parent,skill);
    const stat=statIfPresent(destination);
    if(stat){
      directory(destination);
      if(JSON.stringify(collect(destination))!==JSON.stringify(files)||
         files.some(file=>!readFileSync(join(source,file)).equals(readFileSync(join(destination,file)))))
        throw Error("Existing divergent skill; review and remove or move it yourself: "+destination);
      plans.push({destination,parent,action:"unchanged"});
    }else plans.push({destination,parent,action:"install"});
  }
  // Preflight all targets before writing anything. Never replace existing files.
  if(!dryRun){
    const created=[];
    try{
      for(const plan of plans){
        if(plan.action!=="install")continue;
        mkdirSync(plan.parent,{recursive:true});
        directory(plan.parent);
        mkdirSync(plan.destination);
        created.push(plan.destination);
        for(const file of files){
          const to=join(plan.destination,file);
          mkdirSync(dirname(to),{recursive:true});
          writeFileSync(to,readFileSync(join(source,file)),{flag:"wx"});
        }
      }
    }catch(error){
      for(const path of created.reverse())rmSync(path,{recursive:true,force:true});
      throw error;
    }
  }
  return {schema:"zaakiy.skill-install/1",agent,project:target,dryRun,
    plans:plans.map(({destination,action})=>({destination,action:dryRun&&action==="install"?"would-install":action}))};
}
function main(){
  const args=process.argv.slice(2);
  if(args.length===1&&args[0]==="--help"){
    console.log("Usage: node install.mjs --agent codex|antigravity|claude|cursor|all --project <directory> [--dry-run]");
    return;
  }
  const values={};let dryRun=false;
  for(let i=0;i<args.length;i++){
    const arg=args[i];
    if(arg==="--dry-run"&&!dryRun){dryRun=true;continue;}
    if(!["--agent","--project"].includes(arg)||Object.hasOwn(values,arg)||!args[i+1]||args[i+1].startsWith("--"))
      throw Error("Invalid argument; use --help");
    values[arg]=args[++i];
  }
  if(!values["--agent"]||!values["--project"])throw Error("Both --agent and --project are required");
  console.log(JSON.stringify(install(values["--agent"],values["--project"],dryRun),null,2));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  try{main();}catch(error){console.error(error.message);process.exitCode=1;}
}
