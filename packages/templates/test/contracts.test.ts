import {createHash} from "node:crypto";
import {readFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import {describe,it,expect} from "vitest";
import {getTemplate,validateTemplate,planTemplate,sha256Utf8} from "../src/index.js";
import type {TemplateManifestV1} from "../src/index.js";
const ids=["dashboard","authentication","settings","crud"] as const;
async function rawAssets(id:typeof ids[number]):Promise<Record<string,string>>{
  const manifest=getTemplate(id)!;
  const result:Record<string,string>={};
  for(const asset of manifest.assets){
    const url=new URL("../templates/"+id+"/"+asset.path,import.meta.url);
    result[asset.path]=await readFile(fileURLToPath(url),"utf8");
  }
  return result;
}
const variables={
  "__PROJECT_NAME__":"verified-app",
  "__BRAND_NAME__":"Verified App",
  "__PRIMARY_COLOR__":"#aabbcc",
  "__APPEARANCE__":"system",
  "__RADIUS_VALUE__":"0.5rem"
};
describe("P2 Contract 12 manifests and immutable plans",()=>{
  it("matches Node SHA-256 including Unicode",()=>{
    for(const text of ["","abc","Éclair — dashboard","🧪","\ud800","\udc00","a\ud800b","\ud800\udc00"]){
      expect(sha256Utf8(text)).toBe(createHash("sha256").update(text,"utf8").digest("hex"));
    }
  });
  it.each(ids)("%s metadata, raw assets and plans verify",async id=>{
    const manifest=getTemplate(id)!;
    const source=await rawAssets(id);
    expect(manifest.version).toBe("0.1.0");
    expect(manifest.kind).toBe("project");
    expect(manifest.compatibility.domAbi).toBe(1);
    expect(manifest.compatibility.irSchema).toBe(1);
    expect(validateTemplate(manifest,source)).toEqual([]);
    const input={manifest,targetDirectory:"/approved-root",variables,existingPaths:[],assetContents:source};
    const first=planTemplate(input),again=planTemplate(input);
    expect(first).toEqual(again);
    expect(first.diagnostics).toEqual([]);
    expect(first.writes).toHaveLength(14);
    expect(first.writes.every(w=>w.kind==="create")).toBe(true);
    for(const output of first.writes){
      expect(output.contentSha256).toBe(createHash("sha256").update(output.content).digest("hex"));
      expect(output.content).not.toMatch(/__[A-Z][A-Z0-9_]*__/);
    }
  });
  it("rejects source tampering, unsafe input and collisions",async()=>{
    const manifest=getTemplate("dashboard")!;
    const source=await rawAssets("dashboard");
    const changed={...source,"README.md":source["README.md"]+"tampered"};
    expect(validateTemplate(manifest,changed).some(d=>d.code==="ZT_CHECKSUM")).toBe(true);
    expect(planTemplate({manifest,targetDirectory:"/root",variables,existingPaths:[],assetContents:changed}).writes).toEqual([]);
    const conflict=planTemplate({manifest,targetDirectory:"/root",variables,existingPaths:["readme.MD"],assetContents:source});
    expect(conflict.diagnostics.some(d=>d.code==="ZT_COLLISION")).toBe(true);
    expect(conflict.writes).toEqual([]);
    const skipped=planTemplate({manifest,targetDirectory:"/root",variables,existingPaths:["README.md"],overwrite:"skip",assetContents:source});
    expect(skipped.diagnostics).toEqual([]);
    expect(skipped.writes).toHaveLength(13);
    const replaced=planTemplate({manifest,targetDirectory:"/root",variables,existingPaths:["README.md"],
      authorizedReplacements:{"README.md":"a".repeat(64)},assetContents:source});
    expect(replaced.writes.find(w=>w.relativePath==="README.md")?.kind).toBe("replace");
    expect(replaced.writes.find(w=>w.relativePath==="README.md")?.expectedExistingSha256).toBe("a".repeat(64));
    const injected=planTemplate({manifest,targetDirectory:"/root",variables:{...variables,"__BRAND_NAME__":"bad\";evil()"},
      existingPaths:[],assetContents:source});
    expect(injected.writes).toEqual([]);
    expect(injected.diagnostics.some(d=>d.code==="ZT_VARIABLE")).toBe(true);
  });
  it("rejects malformed schemas, hashes, traversal and dependencies",async()=>{
    const manifest=getTemplate("crud")!;
    const source=await rawAssets("crud");
    const broken={...manifest,assets:[{...manifest.assets[0]!,path:"../escape",contentSha256:"a".repeat(64)}]} as TemplateManifestV1;
    expect(validateTemplate(broken,source).some(d=>d.code==="ZT_PATH")).toBe(true);
    const badVersion={...manifest,version:"latest",packages:{"@zaakiyjs/dom":"latest"}} as TemplateManifestV1;
    const codes=validateTemplate(badVersion,source).map(d=>d.code);
    expect(codes).toContain("ZT_VERSION");
    expect(codes).toContain("ZT_DEPENDENCY");
  });
});
