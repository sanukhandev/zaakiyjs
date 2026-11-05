import {getTemplate} from "./registry.js";
import {TemplateError} from "./types.js";
import type {MaterializedFile, PlannedTemplateFile, TemplateOptions, TemplatePlan, TemplateRequest} from "./types.js";
const reserved = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
const allowedOptions = new Set(["brandName","primaryColor","appearance","radius"]);
export function validateProjectName(value: string): string {
  if (typeof value !== "string" || value.length > 100 ||
      !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(value) || reserved.test(value)) {
    throw new TemplateError("INVALID_PROJECT_NAME","Project names must be lowercase kebab-case, at most 100 characters.");
  }
  return value;
}
/** Pure validation: no FS, browser, environment, or network dependency. */
export function safeRelativePath(value: string): string {
  if (typeof value !== "string" || !value || value.length > 1024 ||
      value.startsWith("/") || value.includes("\\") || /^[a-zA-Z]:/.test(value) ||
      /[\x00-\x1f<>:"|?*]/.test(value)) {
    throw new TemplateError("UNSAFE_PATH","Expected a safe relative project path.");
  }
  const segments = value.replaceAll("\\","/").split("/");
  if (segments.some(s => !s || s === "." || s === ".." || s.length > 120 ||
      reserved.test(s) || /[. ]$/.test(s))) {
    throw new TemplateError("UNSAFE_PATH","Unsafe project path component.");
  }
  return segments.join("/");
}
function normalizeOptions(input: TemplateOptions | undefined, projectName: string): Required<TemplateOptions> {
  if (input !== undefined && (typeof input !== "object" || input === null || Array.isArray(input) ||
    Object.getPrototypeOf(input) !== Object.prototype)) {
    throw new TemplateError("INVALID_OPTION","Template options must be a plain object.");
  }
  for (const key of Object.keys(input ?? {})) {
    if (!allowedOptions.has(key)) throw new TemplateError("INVALID_OPTION",`Unknown template option: ${key}`);
  }
  const brandName = input?.brandName ?? projectName;
  const primaryColor = input?.primaryColor ?? "#334ac0";
  const appearance = input?.appearance ?? "system";
  const radius = input?.radius ?? "md";
  if (typeof brandName !== "string" || brandName.length > 64 || !/^[\p{L}\p{N}][\p{L}\p{N} ._-]*$/u.test(brandName)) {
    throw new TemplateError("INVALID_OPTION","Invalid brandName.");
  }
  if (typeof primaryColor !== "string" || !/^#[0-9a-fA-F]{6}$/.test(primaryColor) ||
      !["system","light","dark"].includes(appearance) ||
      !["sm","md","lg"].includes(radius)) {
    throw new TemplateError("INVALID_OPTION","Invalid primaryColor, appearance, or radius.");
  }
  return Object.freeze({brandName,primaryColor:primaryColor.toLowerCase(),appearance,radius});
}
function validatePaths(files: readonly PlannedTemplateFile[]): void {
  const seen = new Set<string>();
  for (const f of files) {
    const path = safeRelativePath(f.path);
    safeRelativePath(f.asset);
    const key = path.toLowerCase();
    if (seen.has(key) || [...seen].some(p => p.startsWith(key+"/") || key.startsWith(p+"/"))) {
      throw new TemplateError("DUPLICATE_PATH",`File collision: ${path}`);
    }
    seen.add(key);
  }
}
export function createTemplatePlan(request: TemplateRequest): TemplatePlan {
  const manifest = getTemplate(request.template);
  if (!manifest) throw new TemplateError("UNKNOWN_TEMPLATE", "Unknown ZaakiyJS template.");
  const projectName = validateProjectName(request.projectName);
  const prefix = request.basePath === undefined ? "" : safeRelativePath(request.basePath) + "/";
  const files = Object.freeze(manifest.generatedFiles.map(name => {
    const path = safeRelativePath(name);
    return Object.freeze({path:prefix+path,asset:safeRelativePath(`${manifest.id}/${path}`)});
  }));
  validatePaths(files);
  return Object.freeze({
    schemaVersion:1,template:manifest.id,status:manifest.status,
    projectName,options:normalizeOptions(request.options,projectName),
    files,requiredPackages:manifest.requiredPackages,minimumVersions:manifest.minimumVersions
  });
}
/** Preflight to pass to a future atomic CLI writer. No files are ever written here. */
export function validateMaterializedFiles(files: readonly MaterializedFile[]): readonly MaterializedFile[] {
  const planned = files.map(f => ({path:f.path,asset:"asset"}));
  validatePaths(planned);
  for (const file of files) if (typeof file.content !== "string") {
    throw new TemplateError("INVALID_ASSET","Generated file content must be text.");
  }
  return files.map(f => Object.freeze({path:safeRelativePath(f.path),content:f.content}));
}
