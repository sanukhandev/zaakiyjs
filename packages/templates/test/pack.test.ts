import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {describe,it,expect} from "vitest";
const packageRoot=fileURLToPath(new URL("../",import.meta.url));
describe("independent npm package artifact",()=>{
  it("packs registry, Node adapter, integrity metadata and all four editable source trees",()=>{
    const result=spawnSync("npm",["pack","--dry-run","--json"],{
      cwd:packageRoot,encoding:"utf8",timeout:30000,maxBuffer:4*1024*1024
    });
    expect(result.error).toBeUndefined();
    expect(result.status,result.stderr||"npm pack failed").toBe(0);
    const items=JSON.parse(result.stdout) as Array<{files:Array<{path:string}>,size:number}>;
    expect(items).toHaveLength(1);
    const paths=items[0]!.files.map(f=>f.path);
    for(const needed of ["dist/index.js","dist/index.d.ts","dist/node.js","dist/node.d.ts",
      "dist/hash.js","README.md","CHANGELOG.md"])expect(paths).toContain(needed);
    for(const category of ["dashboard","authentication","settings","crud"]){
      expect(paths.filter(path=>path.startsWith("templates/"+category+"/"))).toHaveLength(14);
    }
    expect(paths.some(p=>p.includes("node_modules")||p.includes(".env")||p.startsWith("test/"))).toBe(false);
    expect(items[0]!.size).toBeGreaterThan(0);
  },45000);
});
