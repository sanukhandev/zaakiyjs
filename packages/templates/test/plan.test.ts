import {describe,it,expect} from "vitest";
import {createTemplatePlan,getTemplate,listTemplates,materializeTemplatePlan,
  safeRelativePath,TemplateError,validateMaterializedFiles} from "../src/index.js";
describe("template registry",() => {
  it("has four unique typed draft categories",()=>{
    const items=listTemplates();
    expect(items.map(i=>i.id)).toEqual(["authentication","crud","dashboard","settings"]);
    expect(new Set(items.map(i=>i.id)).size).toBe(4);
    for(const item of items) {
      expect(item.schemaVersion).toBe(1);
      expect(item.requiredPackages.length).toBeGreaterThan(0);
      expect(item.status).toBe("draft");
      expect(Object.keys(item.minimumVersions).sort()).toEqual([...item.requiredPackages].sort());
      expect(getTemplate(item.id)).toBe(item);
      expect(item.generatedFiles.length).toBeGreaterThan(10);
    }
  });
  it.each(["..","./x","a/../b","/tmp/x","C:\\boot","foo//bar","foo\\..\\bar","CON","foo."])(
    "rejects unsafe paths %s",p=>expect(()=>safeRelativePath(p)).toThrow(TemplateError));
  it.each(["../escape","PascalCase","two words","a/dir",".env","x--y"])(
    "rejects invalid project name %s",name=>expect(()=>createTemplatePlan({template:"crud",projectName:name})).toThrow(TemplateError));
  it("rejects unknown options and escapes",()=>{
    expect(()=>createTemplatePlan({template:"dashboard",projectName:"demo",options:{primaryColor:"red"}})).toThrow();
    expect(()=>createTemplatePlan({template:"dashboard",projectName:"demo",options:{brandName:"x\"; alert(1)"}})).toThrow();
    expect(()=>createTemplatePlan({template:"dashboard",projectName:"demo",options:{danger:"yes"} as never})).toThrow();
  });
  it("generates identical plans without mutation or I/O",()=>{
    const input={template:"dashboard" as const,projectName:"my-dashboard",options:{primaryColor:"#AA33FF"}};
    const first=createTemplatePlan(input),second=createTemplatePlan(input);
    expect(first).toEqual(second);
    expect(first.options.primaryColor).toBe("#aa33ff");
    expect(first.files.every(file=>file.path.startsWith("src/") || !file.path.includes("/"))).toBe(true);
    expect(Object.isFrozen(first)).toBe(true);
  });
  it("supports relative nested destination without traversal",()=>{
    expect(createTemplatePlan({template:"settings",projectName:"safe",basePath:"apps/admin"}).files[0]?.path).toBe("apps/admin/README.md");
    expect(()=>createTemplatePlan({template:"settings",projectName:"safe",basePath:"../tmp"})).toThrow();
  });
  it("rejects case-insensitive and directory/file collisions",()=>{
    expect(()=>validateMaterializedFiles([{path:"A",content:""},{path:"a",content:""}])).toThrow();
    expect(()=>validateMaterializedFiles([{path:"src",content:""},{path:"src/a.ts",content:""}])).toThrow();
  });
  it.each(["dashboard","authentication","settings","crud"] as const)("materializes %s without secrets",async id=>{
    const plan=createTemplatePlan({template:id,projectName:"safe-demo",options:{brandName:"Safe Demo"}});
    const files=await materializeTemplatePlan(plan);
    expect(files.map(x=>x.path)).toEqual(plan.files.map(x=>x.path));
    expect(files.find(x=>x.path==="zaakiy.config.ts")?.content).toContain("Safe Demo");
    for (const file of files) {
      expect(file.content).not.toMatch(/__[A-Z][A-Z0-9_]*__/);
      expect(file.content).not.toMatch(/client_secret/); 
    }
  });
});
