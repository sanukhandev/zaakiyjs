import {mkdtemp,mkdir,writeFile,rm,readFile,readdir} from "node:fs/promises";
import {join,dirname} from "node:path";
import {fileURLToPath} from "node:url";
import ts from "typescript";
import {build} from "vite";
import {describe,it,expect} from "vitest";
import {createTemplatePlan} from "../src/index.js";
import {materializeTemplatePlan} from "../src/node.js";
const templates=["dashboard","authentication","settings","crud"] as const;
async function stage(template:typeof templates[number]):Promise<string>{
  const root=await mkdtemp(join(dirname(fileURLToPath(import.meta.url)),".generated-"));
  try {
    const source=await materializeTemplatePlan(createTemplatePlan({template,projectName:"verified-app"}));
    for(const file of source){
      const at=join(root,file.path);
      await mkdir(dirname(at),{recursive:true});
      await writeFile(at,file.content,"utf8");
    }
    return root;
  }catch(error){await rm(root,{recursive:true,force:true});throw error;}
}
describe("generated clean-room TypeScript and Vite builds",()=>{
  it.each(templates)("%s typechecks and emits production JS without browser-template runtime",async template=>{
    const root=await stage(template);
    try{
      const configFile=join(root,"tsconfig.json");
      const config=ts.readConfigFile(configFile,ts.sys.readFile);
      if(config.error)throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText,"\n"));
      const options=ts.parseJsonConfigFileContent(config.config,ts.sys,root);
      const program=ts.createProgram(options.fileNames,options.options);
      const errors=ts.getPreEmitDiagnostics(program).filter(d=>d.category===ts.DiagnosticCategory.Error);
      expect(errors.map(d=>`${d.file?.fileName}:${d.start}: ${ts.flattenDiagnosticMessageText(d.messageText," ")}`)).toEqual([]);
      await build({root,configFile:join(root,"vite.config.ts"),logLevel:"error",build:{minify:true}});
      const index=await readFile(join(root,"dist","index.html"),"utf8");
      const assets=await readdir(join(root,"dist","assets"));
      expect(index).toContain("verified-app");
      expect(assets.some(x=>x.endsWith(".js"))).toBe(true);
      expect(assets.some(x=>x.endsWith(".css"))).toBe(true);
      const js=await Promise.all(assets.filter(x=>x.endsWith(".js")).map(x=>readFile(join(root,"dist","assets",x),"utf8")));
      for(const source of js){
        expect(source).not.toMatch(/(?:client_secret|VITE_PRIVATE_KEY|AIza[0-9A-Za-z_-]{30,})/i);
        expect(source).not.toContain("@zaakiyjs/templates");
      }
    }finally{
      await rm(root,{recursive:true,force:true});
    }
  },90000);
});
