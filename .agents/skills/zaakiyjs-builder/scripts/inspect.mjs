import {existsSync, readFileSync, statSync} from "node:fs";
import {resolve,join} from "node:path";
import {pathToFileURL} from "node:url";

const names=["signals","core","dom","compiler","styles","vite-plugin","cli","router","forms","async","http","proxy","ssr","seo","compat","store","ui-primitives","ui","templates","motion","image","ads","analytics","consent"];
const BASELINE="5fe0e1765bc802ea3f3eebb76a43bd585166c518";

function readManifest(file){
  if(!existsSync(file))return null;
  const info=statSync(file);
  if(!info.isFile()||info.size>1024*1024)throw Error("Invalid or oversized manifest: "+file);
  const data=JSON.parse(readFileSync(file,"utf8"));
  if(!data||typeof data!=="object"||Array.isArray(data))throw Error("Invalid manifest: "+file);
  return data;
}
export function inspect(project){
  const directory=resolve(project);
  if(!statSync(directory).isDirectory())throw Error("Project must be a directory");
  const root=readManifest(join(directory,"package.json"));
  const workspace=root?.name==="zaakiyjs-monorepo"&&existsSync(join(directory,"pnpm-workspace.yaml"));
  const declarations={...root?.dependencies,...root?.devDependencies,...root?.peerDependencies};
  const packages=[];
  for(const name of names){
    const pkg="@zaakiyjs/"+name;
    const path=workspace?join(directory,"packages",name,"package.json"):join(directory,"node_modules","@zaakiyjs",name,"package.json");
    const data=readManifest(path);
    if(!data&&!(pkg in declarations))continue;
    packages.push({name:pkg,declared:declarations[pkg]??null,
      manifestVersion:data?.version??null,manifestPath:data?path:null,
      exports:data?.exports??null,localOnly:data?.version==="0.0.0"});
  }
  const kind=workspace?"framework-workspace":
    packages.length?"zaakiyjs-application":root?"other-project":"uninitialized";
  return {schema:"zaakiy.agent-inspection/1",referenceCommit:BASELINE,project:directory,kind,
    packageManager:root?.packageManager??null,hasLockfile:existsSync(join(directory,"pnpm-lock.yaml")),
    scripts:Object.keys(root?.scripts??{}).sort(),packages,
    notes:["Read-only manifest inventory; no dependency code executed.",
      "Manifest existence does not establish valid exports, successful builds or public npm availability.",
      "Inspect source/declarations, nested app manifests and current tests before implementing."]};
}
function main(){
  const args=process.argv.slice(2);
  if(args.length===1&&args[0]==="--help"){
    console.log("Usage: node inspect.mjs --project <directory>");return;
  }
  if(args.length!==2||args[0]!=="--project"||!args[1])throw Error("Use --help; an explicit project is required");
  console.log(JSON.stringify(inspect(args[1]),null,2));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  try{main();}catch(error){console.error(error.message);process.exitCode=1;}
}
