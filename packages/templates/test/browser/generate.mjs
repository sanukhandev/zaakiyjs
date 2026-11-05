import {mkdir,rm,writeFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import {dirname,join} from "node:path";
import {build} from "vite";
import {createTemplatePlan} from "../../dist/index.js";
import {materializeTemplatePlan} from "../../dist/node.js";
const packageRoot=fileURLToPath(new URL("../../",import.meta.url));
const root=join(packageRoot,"test/.browser-generated");
const ids=["dashboard","authentication","settings","crud"];
await rm(root,{recursive:true,force:true});
await mkdir(root,{recursive:true});
for(const id of ids){
  const target=join(root,id);
  await mkdir(target,{recursive:true});
  const plan=createTemplatePlan({template:id,projectName:"zaakiy-template-demo"});
  const files=await materializeTemplatePlan(plan);
  for(const file of files){
    const destination=join(target,file.path);
    await mkdir(dirname(destination),{recursive:true});
    await writeFile(destination,file.content,"utf8");
  }
  await build({root:target,configFile:join(target,"vite.config.ts"),logLevel:"error",build:{minify:true}});
  console.log("Built editable",id,"template:",files.length,"files");
}
