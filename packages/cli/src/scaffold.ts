import {createHash} from "node:crypto";
import {readFile, lstat} from "node:fs/promises";
import {dirname, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {CliError} from "./args.js";
import {safeRelativePath, validateProjectName, writeProject, type PlannedWrite} from "./fs-safe.js";

export type Preset = "minimal" | "standard" | "enterprise";
export type Versions = Readonly<Record<"core" | "dom" | "signals" | "styles" | "vite-plugin", string>>;
const requiredFiles = ["package.json.tmpl", "tsconfig.json", "vite.config.ts", "zaakiy.config.ts",
  "index.html", "src/App.tsx", "src/main.tsx", "src/base.css", "tests/scaffold.test.mjs", "gitignore.tmpl", "README.md.tmpl"] as const;
const templateBlobHashes: Readonly<Record<string, string>> = {
  "package.json.tmpl": "3eca175929ee83218ae28495c95b2d65587f9c24",
  "tsconfig.json": "aa954827ae95e597ebc6e4ea0753e2994be3cb92",
  "vite.config.ts": "0e7a21d01597b11497c1aad4c0b01e1e5e001423",
  "zaakiy.config.ts": "23aa46f725bbb7b3704a07ec83addb481d01bfe7",
  "index.html": "49eabdc95ff2eb50bc7af6a984d19123156cec79",
  "src/App.tsx": "5d4e97ce9b2b470cb727d830b443e31176b07681",
  "src/main.tsx": "8d6a8c319eaa2bec8cb4718755b4898650ae0381",
  "src/base.css": "ed7e0e7e27b66f5e27b0419683f0741442d42543",
  "tests/scaffold.test.mjs": "76d5525ecda4dc37dc37a0ac068e40b72d4e8d57",
  "gitignore.tmpl": "7da9c936635b4372e739c683f47194da4334e8a5",
  "README.md.tmpl": "7df8fcbad13f32830994d11756b93d212462c060"
};
const packageNames = ["core", "dom", "signals", "styles", "vite-plugin"] as const;
const packageRoot = fileURLToPath(new URL("../templates/minimal/", import.meta.url));

export function parsePreset(value: string | undefined): Preset {
  if (value === undefined) return "minimal";
  if (value === "minimal" || value === "standard" || value === "enterprise") return value;
  throw new CliError("UNKNOWN_PRESET", "Unknown preset " + value + ". Supported: minimal, standard, enterprise.");
}
function parseVersion(input: unknown, name: string): string {
  if (typeof input !== "string" || !/^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/i.test(input)) {
    throw new CliError("INVALID_PACKAGE_VERSION", "Invalid installed version for " + name);
  }
  return input;
}
async function installedVersion(name: string): Promise<string> {
  let resolved: string;
  try { resolved = import.meta.resolve("@zaakiyjs/" + name); }
  catch (error) { throw new CliError("PACKAGE_NOT_FOUND", "Cannot resolve ESM package @zaakiyjs/" + name + ": " + String(error)); }
  if (!resolved.startsWith("file:")) throw new CliError("PACKAGE_NOT_FOUND", "Non-file package entry: " + resolved);
  let current = dirname(fileURLToPath(resolved));
  while (true) {
    try {
      const data: unknown = JSON.parse(await readFile(join(current, "package.json"), "utf8"));
      if (data && typeof data === "object" && "name" in data && data.name === "@zaakiyjs/" + name) {
        return parseVersion("version" in data ? data.version : undefined, name);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const next = dirname(current);
    if (current === next) throw new CliError("PACKAGE_NOT_FOUND", "Cannot locate installed @zaakiyjs/" + name);
    current = next;
  }
}
export async function getInstalledVersions(workspace: boolean): Promise<Versions> {
  const result = {} as Record<(typeof packageNames)[number], string>;
  for (const name of packageNames) {
    let version: string;
    try { version = await installedVersion(name); }
    catch (error) {
      throw new CliError("MISSING_FRAMEWORK_DEPENDENCY", "Required @zaakiyjs/" + name + " package is unavailable: " + String(error));
    }
    if (version === "0.0.0" && !workspace) {
      throw new CliError("UNPUBLISHED_FRAMEWORK", "@zaakiyjs/" + name + " is at the M0 0.0.0 contract version. Publish compatible versions before generating a standalone application.");
    }
    result[name] = workspace ? "workspace:^" : "^" + version;
  }
  return result;
}
export async function assertFrameworkReady(): Promise<void> {
  try {
    const [core, dom, vite, signals, styles] = await Promise.all([
      import("@zaakiyjs/core"), import("@zaakiyjs/dom"), import("@zaakiyjs/vite-plugin"), import("@zaakiyjs/signals"), import("@zaakiyjs/styles")
    ]);
    const has = (value: unknown, name: string): boolean =>
      typeof (value as Record<string, unknown>)[name] === "function";
    const unimplemented = [core, dom, vite, signals, styles].some(module => {
      const status = (module as {foundationStatus?: {implemented?: boolean}}).foundationStatus;
      return status?.implemented === false;
    });
    if (unimplemented || !has(signals, "signal") || !has(dom, "mount") || !has(vite, "zaakiyPlugin")) {
      throw new Error("signal() from @zaakiyjs/signals, mount() from @zaakiyjs/dom or zaakiyPlugin() from @zaakiyjs/vite-plugin is unavailable");
    }
  } catch (error) {
    throw new CliError("FOUNDATION_NOT_READY", "Cannot scaffold a buildable app: the installed ZaakiyJS runtime/compiler integration is not ready. " + String(error));
  }
}
function replaceTokens(content: string, name: string, preset: Preset, manager: string, versions: Versions): string {
  let result = content
    .replaceAll("__PROJECT_NAME__", name)
    .replaceAll("__PRESET__", preset)
    .replaceAll("__PACKAGE_MANAGER__", manager);
  for (const pkg of packageNames) result = result.replaceAll("__VERSION_" + pkg.toUpperCase().replace("-", "_") + "__", versions[pkg]);
  if (/__[A-Z][A-Z0-9_]*__/.test(result)) throw new CliError("INVALID_TEMPLATE", "Unresolved template token detected");
  return result;
}
export async function scaffoldPlan(name: string, preset: Preset, manager: string, versions: Versions): Promise<PlannedWrite[]> {
  validateProjectName(name);
  const files: PlannedWrite[] = [];
  for (const file of requiredFiles) {
    const fullPath = resolve(packageRoot, file);
    const info = await lstat(fullPath).catch(() => { throw new CliError("INVALID_TEMPLATE", "Missing template file " + file); });
    if (!info.isFile() || info.isSymbolicLink() || info.size > 100_000) throw new CliError("INVALID_TEMPLATE", "Unsafe template file " + file);
    const content = await readFile(fullPath, "utf8");
    const sha = createHash("sha1").update("blob " + Buffer.byteLength(content, "utf8") + "\0").update(content).digest("hex");
    if (sha !== templateBlobHashes[file]) throw new CliError("INVALID_TEMPLATE", "Template integrity check failed: " + file);
    const path = file === "gitignore.tmpl" ? ".gitignore" : file.endsWith(".tmpl") ? file.slice(0, -5) : file;
    files.push({path: safeRelativePath(path), content: replaceTokens(content, name, preset, manager, versions)});
  }
  JSON.parse(files.find(file => file.path === "package.json")?.content ?? "");
  if (preset !== "minimal") {
    files.push({path: "src/features/README.md", content: "# Features\n\nOrganize feature modules by cohesive responsibility. No router is required.\n"});
    files.push({path: "src/shared/README.md", content: "# Shared\n\nPlace reusable, framework-independent domain contracts here.\n"});
  }
  if (preset === "enterprise") {
    files.push({path: "src/app/providers/README.md", content: "# Providers\n\nCompose application-root dependencies here. Do not use process-global mutable singletons.\n"});
    files.push({path: "src/app/branding/README.md", content: "# Branding\n\nUse the typed root zaakiy.config.ts as the build-time brand source.\n"});
    files.push({path: "src/features/README-mvvm.md", content: "# MVVM\n\nFeature folders may contain model, viewmodel, view, services and adapters. ViewModels depend on model interfaces, never UI or infrastructure implementations.\n"});
  }
  return files;
}
export async function scaffoldProject(input: {
  cwd: string; name: string; preset: Preset; manager: string;
  outputPath?: string; dryRun: boolean; force: boolean; versions: Versions
}): Promise<string[]> {
  const parent = input.outputPath ? resolve(input.cwd, safeRelativePath(input.outputPath)) : resolve(input.cwd);
  return writeProject(parent, input.name, await scaffoldPlan(input.name, input.preset, input.manager, input.versions), {dryRun: input.dryRun, force: input.force});
}
