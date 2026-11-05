import {lstat, readFile} from "node:fs/promises";
import {resolve, relative, isAbsolute, sep} from "node:path";
import {fileURLToPath} from "node:url";
import {TemplateError} from "./types.js";
import {safeRelativePath, validateMaterializedFiles} from "./plan.js";
import type {MaterializedFile,TemplatePlan} from "./types.js";
/** Installed package payload: src/ and dist/ are siblings of the templates/ directory. */
const assetRoot = fileURLToPath(new URL("../templates/",import.meta.url));
function interpolate(text: string, plan: TemplatePlan): string {
  const variables: Readonly<Record<string,string>> = {
    "__PROJECT_NAME__":plan.projectName,
    "__BRAND_NAME__":plan.options.brandName,
    "__PRIMARY_COLOR__":plan.options.primaryColor,
    "__APPEARANCE__":plan.options.appearance,
    "__RADIUS__":plan.options.radius,
    "__RADIUS_VALUE__":({sm:"0.25rem",md:"0.5rem",lg:"0.75rem"} as const)[plan.options.radius]
  };
  let output = text;
  for (const [key,value] of Object.entries(variables)) output=output.replaceAll(key,value);
  if (/__[A-Z][A-Z0-9_]*__/.test(output)) throw new TemplateError("INVALID_ASSET","Unresolved source template variable.");
  return output.replaceAll("\r\n","\n");
}
/** Read only exact registered assets; no scripts, arbitrary templates or project writes. */
export async function materializeTemplatePlan(plan: TemplatePlan): Promise<readonly MaterializedFile[]> {
  if (plan.schemaVersion !== 1) throw new TemplateError("INVALID_ASSET","Unsupported plan version.");
  const root = resolve(assetRoot);
  const files: MaterializedFile[] = [];
  for (const file of plan.files) {
    const asset = safeRelativePath(file.asset);
    if (!asset.startsWith(plan.template+"/")) {
      throw new TemplateError("INVALID_ASSET","Asset does not belong to the planned template.");
    }
    const target = resolve(root,asset);
    const rel = relative(root,target);
    if (!rel || rel === ".." || rel.startsWith(".."+sep) || isAbsolute(rel)) {
      throw new TemplateError("UNSAFE_PATH","Asset escapes the packaged template root.");
    }
    // Reject symlink parents and sources even when the asset list was constructed by a caller.
    let candidate = root;
    for (const segment of rel.split(sep)) {
      candidate=resolve(candidate,segment);
      const entry=await lstat(candidate).catch(() => {throw new TemplateError("INVALID_ASSET","Missing template asset.");});
      if (entry.isSymbolicLink()) throw new TemplateError("INVALID_ASSET","Symlinked template assets are forbidden.");
    }
    const info=await lstat(target);
    if (!info.isFile() || info.size > 150_000) throw new TemplateError("INVALID_ASSET","Invalid or oversized template asset.");
    files.push({path:safeRelativePath(file.path),content:interpolate(await readFile(target,"utf8"),plan)});
  }
  return Object.freeze([...validateMaterializedFiles(files)]);
}
