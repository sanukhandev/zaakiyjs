import {mkdtemp,mkdir,writeFile,rm} from "node:fs/promises";
import {join,dirname} from "node:path";
import {fileURLToPath} from "node:url";
import {describe,it,expect} from "vitest";
import {compile} from "@zaakiyjs/compiler";
import {createTemplatePlan} from "../src/index.js";
import {materializeTemplatePlan} from "../src/node.js";

describe("generated projects against actual Zaakiy compiler",()=>{
  it.each(["dashboard","authentication","settings","crud"] as const)(
    "%s compiles every TSX module with resolved imports",async template=>{
      const files=await materializeTemplatePlan(createTemplatePlan({template,projectName:"verified-app"}));
      const tmp=await mkdtemp(join(dirname(fileURLToPath(import.meta.url)),".generated-"));
      const errors:string[]=[];
      try {
        for(const file of files) {
          const destination=join(tmp,file.path);
          await mkdir(dirname(destination),{recursive:true});
          await writeFile(destination,file.content,"utf8");
        }
        for(const f of files.filter(x=>x.path.endsWith(".tsx"))) {
          const result=compile({fileName:join(tmp,f.path),source:f.content});
          for(const d of result.diagnostics.filter(x=>x.severity==="error")){
            errors.push(f.path+": "+d.code+" "+d.message+" @"+(d.span?.start.line??0));
          }
        }
        expect(errors).toEqual([]);
      } finally {
        await rm(tmp,{recursive:true,force:true});
      }
    }
  );
});
