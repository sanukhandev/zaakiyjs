import {sha256Utf8} from "./hash.js";
import {safeRelativePath,validateProjectName} from "./plan.js";

/** Contract 12: portable, editable project/page source manifests and pure write plans. */
export type TemplateKind="project"|"page";
export type TemplateCapability="core"|"signals"|"dom"|"styles"|"router"|"forms"|
 "ui"|"ui-primitives"|"motion"|"async"|"http";
export interface TemplateCompatibility {
  readonly compiler:string;
  readonly domAbi:1;
  readonly irSchema:1;
  readonly browserTargets?:Readonly<Record<"chrome"|"firefox"|"safari",number>>;
  readonly requiredFeatures:readonly TemplateCapability[];
  readonly optionalFeatures?:readonly TemplateCapability[];
}
export interface TemplateAsset {
  readonly path:string;
  readonly contentSha256:string;
  readonly encoding:"utf-8";
  readonly mode?:"file";
}
export interface TemplateManifestV1 {
  readonly schemaVersion:1;
  readonly id:string;
  readonly version:string;
  readonly kind:TemplateKind;
  readonly name:string;
  readonly description:string;
  readonly license:string;
  readonly compatibility:TemplateCompatibility;
  readonly packages:Readonly<Record<string,string>>;
  readonly assets:readonly TemplateAsset[];
  readonly entry?:string;
}
export interface PlanDiagnostic {
  readonly code:string;
  readonly severity:"error"|"warning";
  readonly message:string;
  readonly path?:string;
}
export interface PlannedWrite {
  readonly kind:"create"|"replace";
  readonly relativePath:string;
  readonly expectedExistingSha256?:string;
  readonly contentSha256:string;
  readonly content:string;
}
/**
 * Source bytes are explicitly injected rather than bundled into the metadata entrypoint.
 * assetContents is an additive input required for concrete content planning; missing
 * content yields diagnostics, never a network call or implicit filesystem access.
 */
export interface PlanRequest {
  readonly manifest:TemplateManifestV1;
  readonly targetDirectory:string;
  readonly variables:Readonly<Record<string,string>>;
  readonly existingPaths:readonly string[];
  readonly authorizedReplacements?:Readonly<Record<string,string>>;
  readonly overwrite?:"error"|"skip";
  readonly assetContents?:Readonly<Record<string,string>>;
}
export interface TemplateFilePlan {
  readonly schemaVersion:1;
  readonly writes:readonly PlannedWrite[];
  readonly dependencies:Readonly<Record<string,string>>;
  readonly diagnostics:readonly PlanDiagnostic[];
}
const semver=/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const range=/^(?:[~^])?(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/;
const hex=/^[a-f0-9]{64}$/;
const capability=new Set<string>(["core","signals","dom","styles","router","forms","ui","ui-primitives","motion","async","http"]);
const diagnostic=(code:string,message:string,path?:string):PlanDiagnostic=>({code,severity:"error",message,...(path?{path}:{})});
function validPath(path:string):boolean {
  try {return safeRelativePath(path)===path;}catch{return false;}
}
function collision(a:string,b:string):boolean {
  const x=a.toLowerCase(),y=b.toLowerCase();
  return x===y||x.startsWith(y+"/")||y.startsWith(x+"/");
}
function validateVariable(key:string,value:string):boolean {
  if(typeof value!=="string")return false;
  switch(key) {
    case "__PROJECT_NAME__":
      try{return validateProjectName(value)===value;}catch{return false;}
    case "__BRAND_NAME__":return value.length>0&&value.length<=64&&/^[\p{L}\p{N}][\p{L}\p{N} ._-]*$/u.test(value);
    case "__PRIMARY_COLOR__":return /^#[a-fA-F0-9]{6}$/.test(value);
    case "__APPEARANCE__":return ["light","dark","system"].includes(value);
    case "__RADIUS__":return ["sm","md","lg"].includes(value);
    case "__RADIUS_VALUE__":return ["0.25rem","0.5rem","0.75rem"].includes(value);
    default:return false;
  }
}
/** Pure metadata validation with SHA-256 verification against supplied raw UTF-8 assets. */
export function validateTemplate(
  manifest:TemplateManifestV1,
  assets:Readonly<Record<string,string>>
):readonly PlanDiagnostic[]{
  const problems:PlanDiagnostic[]=[];
  if(manifest.schemaVersion!==1)problems.push(diagnostic("ZT_SCHEMA","Unsupported template schema."));
  if(!/^[a-z][a-z0-9-]{0,100}$/.test(manifest.id))problems.push(diagnostic("ZT_ID","Invalid template ID."));
  if(!semver.test(manifest.version))problems.push(diagnostic("ZT_VERSION","Invalid manifest SemVer."));
  if(!["project","page"].includes(manifest.kind))problems.push(diagnostic("ZT_KIND","Invalid template kind."));
  if(!manifest.name||!manifest.description||!manifest.license)problems.push(diagnostic("ZT_METADATA","Missing manifest metadata."));
  if(manifest.compatibility?.domAbi!==1||manifest.compatibility?.irSchema!==1||
      !semver.test(manifest.compatibility?.compiler??""))problems.push(diagnostic("ZT_COMPAT","Invalid compiler/ABI compatibility."));
  for(const feature of manifest.compatibility?.requiredFeatures??[]) {
    if(!capability.has(feature))problems.push(diagnostic("ZT_FEATURE","Unknown capability: "+feature));
  }
  for(const [name,version] of Object.entries(manifest.packages??{})){
    if(!/^@zaakiyjs\/[a-z][a-z0-9-]*$/.test(name)||!(range.test(version)||version==="workspace:^")){
      problems.push(diagnostic("ZT_DEPENDENCY","Invalid declared dependency "+name));
    }
  }
  const seen:string[]=[];
  for(const asset of manifest.assets??[]){
    if(!validPath(asset.path)||seen.some(path=>collision(path,asset.path))){
      problems.push(diagnostic("ZT_PATH","Unsafe or colliding asset path.",asset.path));
      continue;
    }
    seen.push(asset.path);
    if(asset.encoding!=="utf-8"||(asset.mode!==undefined&&asset.mode!=="file")||!hex.test(asset.contentSha256)){
      problems.push(diagnostic("ZT_ASSET","Invalid asset encoding, permissions, or hash.",asset.path));
      continue;
    }
    const raw=Object.hasOwn(assets,asset.path)?assets[asset.path]:undefined;
    if(typeof raw!=="string"||sha256Utf8(raw)!==asset.contentSha256){
      problems.push(diagnostic("ZT_CHECKSUM","Missing or mismatched SHA-256 source bytes.",asset.path));
    }
  }
  if(manifest.entry&&!seen.includes(manifest.entry))problems.push(diagnostic("ZT_ENTRY","Entry not in asset list."));
  return Object.freeze(problems);
}
/** Pure, deterministic and explicit; no filesystem, process, network, or script execution. */
export function planTemplate(request:PlanRequest):TemplateFilePlan {
  const problems:PlanDiagnostic[]=[];
  const assets=request.assetContents??{};
  problems.push(...validateTemplate(request.manifest,assets));
  if(typeof request.targetDirectory!=="string"||!request.targetDirectory.trim()||
     [...request.targetDirectory].some(x=>x.charCodeAt(0)<32)){
    problems.push(diagnostic("ZT_TARGET","A valid target directory must be supplied by the trusted adapter."));
  }
  for(const [key,value] of Object.entries(request.variables??{})){
    if(!validateVariable(key,value))problems.push(diagnostic("ZT_VARIABLE","Unrecognized or unsafe template variable "+key));
  }
  const existing:string[]=[];
  for(const file of request.existingPaths??[]){
    if(!validPath(file))problems.push(diagnostic("ZT_EXISTING","Unsafe existing file path.",file));
    else existing.push(file);
  }
  const replacementEntries=Object.entries(request.authorizedReplacements??{});
  for(const [file,hash] of replacementEntries){
    if(!validPath(file)||!hex.test(hash))problems.push(diagnostic("ZT_REPLACEMENT","Invalid replacement authorization.",file));
  }
  if(request.overwrite!==undefined&&!["error","skip"].includes(request.overwrite)) {
    problems.push(diagnostic("ZT_OVERWRITE","Unsupported overwrite policy."));
  }
  const writes:PlannedWrite[]=[];
  if(problems.length===0){
    for(const asset of [...request.manifest.assets].sort((a,b)=>a.path.localeCompare(b.path,"en"))) {
      const conflict=existing.find(path=>collision(path,asset.path));
      const authorized=request.authorizedReplacements?.[asset.path];
      if(conflict && (conflict.toLowerCase()!==asset.path.toLowerCase()||!authorized)){
        if(request.overwrite==="skip")continue;
        problems.push(diagnostic("ZT_COLLISION","Existing file or directory collision.",asset.path));
        continue;
      }
      const original=assets[asset.path]!;
      let content=original;
      for(const key of Object.keys(request.variables).sort()) content=content.replaceAll(key,request.variables[key]!);
      if(/__[A-Z][A-Z0-9_]*__/.test(content)){
        problems.push(diagnostic("ZT_VARIABLE","Unresolved variable in source asset.",asset.path));
        continue;
      }
      writes.push({
        kind:conflict?"replace":"create",
        relativePath:asset.path,
        ...(conflict?{expectedExistingSha256:authorized}:{}),
        contentSha256:sha256Utf8(content),
        content
      });
    }
  }
  return Object.freeze({
    schemaVersion:1,
    writes:Object.freeze(problems.length?[]:writes),
    dependencies:Object.freeze({...request.manifest.packages}),
    diagnostics:Object.freeze(problems)
  });
}
