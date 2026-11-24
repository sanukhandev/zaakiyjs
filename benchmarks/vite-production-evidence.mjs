/** Integrity evidence for the deliberately single-entry B8 fixture.
 * Normalize only the verified entry filename; never discard CSS, manifest
 * metadata, compiler code, or other emitted assets.
 */
import {createHash} from "node:crypto";
import {gzipSync} from "node:zlib";

export const digest=value=>createHash("sha256").update(value).digest("hex");
export function canonicalManifest(content) {
  const parsed=JSON.parse(content);
  if(parsed.schemaVersion!==1||!Array.isArray(parsed.assets))throw Error("Invalid versioned asset manifest");
  const unique=new Map();
  for(const entry of parsed.assets){
    if(!entry||typeof entry.fileName!=="string"||typeof entry.kind!=="string")
      throw Error("Malformed asset metadata");
    const old=unique.get(entry.fileName);
    if(old!==undefined&&JSON.stringify(old)!==JSON.stringify(entry))
      throw Error("Conflicting duplicate asset records");
    unique.set(entry.fileName,entry);
  }
  return {...parsed,assets:[...unique.values()].sort((a,b)=>a.fileName.localeCompare(b.fileName))};
}

export function productionEvidence(assets){
  const files=new Map(assets.map(asset=>[asset.name,asset.content]));
  if(files.size!==assets.length)throw Error("Duplicate emitted files");
  const js=assets.filter(item=>item.name.endsWith(".js"));
  if(js.length!==1||!/^assets\/index-[A-Za-z0-9_-]+\.js$/.test(js[0].name))
    throw Error("B8 runtime comparison requires one hashed entry chunk");
  const entry=js[0].name;
  const html=files.get("index.html"),css=files.get("assets/zaakiy-styles.css");
  const manifest=files.get("zaakiy-assets.json");
  if(typeof html!=="string"||!css||!manifest||assets.length!==4)
    throw Error("Unexpected B8 production asset inventory");
  const normalized=canonicalManifest(manifest);
  const expected=new Map([[entry,"js"],["assets/zaakiy-styles.css","css"],["zaakiy-assets.json","manifest"]]);
  if(normalized.assets.length!==expected.size||
     normalized.assets.some(record=>!files.has(record.fileName)||expected.get(record.fileName)!==record.kind))
    throw Error("Manifest does not attest the complete emitted JS/CSS inventory");
  const entryRefs=[...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"[^>]*>/g)];
  const cssRefs=[...html.matchAll(/<link\b[^>]*\bhref="([^"]+)"[^>]*>/g)];
  if(entryRefs.length!==1||entryRefs[0][1]!=="/"+entry||
     cssRefs.length!==1||cssRefs[0][1]!=="/assets/zaakiy-styles.css")
    throw Error("Invalid production HTML asset references");
  const normalizedHtml=html.replace('src="/'+entry+'"','src="/assets/ENTRY.js"');
  const normalizedManifest={...normalized,assets:normalized.assets.map(record=>
    record.fileName===entry?{...record,fileName:"assets/ENTRY.js"}:record)
    .sort((a,b)=>a.fileName.localeCompare(b.fileName))};
  return {
    entry,
    entrySha256:digest(files.get(entry)),
    cssSha256:digest(css),
    htmlSha256:digest(normalizedHtml),
    manifestSha256:digest(JSON.stringify(normalizedManifest)),
    inventory:assets.map(item=>({name:item.name,sha256:digest(item.content),
      rawBytes:Buffer.byteLength(item.content),gzipBytes:gzipSync(item.content).length}))
  };
}
