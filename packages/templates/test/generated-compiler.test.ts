import {readFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import {describe,it,expect} from "vitest";
import {compile} from "@zaakiyjs/compiler";
import {createTemplatePlan} from "../src/index.js";
import {materializeTemplatePlan} from "../src/node.js";
describe("generated TSX against real Zaakiy compiler",()=>{
  it.each(["dashboard","authentication","settings","crud"] as const)(
    "%s has no unsupported source forms",async template=>{
      const files=await materializeTemplatePlan(createTemplatePlan({template,projectName:"verified-app"}));
      const errors:string[]=[];
      for(const f of files.filter(x=>x.path.endsWith(".tsx"))){
        const result=compile({fileName:"/tmp/verified-app/"+f.path,source:f.content});
        for(const d of result.diagnostics.filter(x=>x.severity==="error")){
          errors.push(f.path+": "+d.code+" "+d.message+" @"+(d.span?.start.line??0));
        }
      }
      expect(errors).toEqual([]);
    }
  );
});
