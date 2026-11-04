import {createRequire} from "node:module";
import {spawnSync} from "node:child_process";
import {readFile, stat} from "node:fs/promises";
import {join} from "node:path";
import type {CliDiagnostic} from "./types.js";

const packages = ["core", "dom", "signals", "styles", "vite-plugin"] as const;
async function textFile(path: string): Promise<string | undefined> {
  try {return await readFile(path, "utf8");}
  catch (error) {if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error;}
}
function diagnostic(code: string, message: string, severity: CliDiagnostic["severity"] = "error"): CliDiagnostic {
  return {code, message, severity};
}
export async function diagnoseProject(cwd: string): Promise<CliDiagnostic[]> {
  const issues: CliDiagnostic[] = [];
  const nodeVersion = process.versions.node.split(".").map(Number);
  if ((nodeVersion[0] ?? 0) < 20 || ((nodeVersion[0] ?? 0) === 20 && (nodeVersion[1] ?? 0) < 19)) {
    issues.push(diagnostic("NODE_UNSUPPORTED", "Node.js 20.19 or newer is required."));
  }
  const manager = process.env.npm_config_user_agent?.split("/")[0] ?? "npm";
  if (["npm", "pnpm", "yarn"].includes(manager)) {
    const command = process.platform === "win32" ? manager + ".cmd" : manager;
    const result = spawnSync(command, ["--version"], {encoding: "utf8", shell: process.platform === "win32"});
    const major = Number((result.stdout ?? "").split(".")[0]);
    const minimum = manager === "pnpm" ? 10 : manager === "yarn" ? 4 : 10;
    if (result.status !== 0 || !Number.isInteger(major) || major < minimum) issues.push(diagnostic("PACKAGE_MANAGER_UNSUPPORTED", manager + " " + minimum + "+ is required."));
  } else issues.push(diagnostic("PACKAGE_MANAGER_UNKNOWN", "Unrecognized package manager " + manager, "warning"));
  const required = ["package.json", "tsconfig.json", "vite.config.ts", "zaakiy.config.ts", "index.html", "src/main.tsx", "src/App.tsx"];
  for (const name of required) {
    const path = join(cwd, name);
    try {if (!(await stat(path)).isFile()) issues.push(diagnostic("INVALID_PROJECT_FILE", name + " must be a file"));}
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") issues.push(diagnostic("MISSING_PROJECT_FILE", "Missing required project file " + name));
      else issues.push(diagnostic("UNREADABLE_PROJECT_FILE", String(error)));
    }
  }
  const config = await textFile(join(cwd, "tsconfig.json"));
  if (config !== undefined) {
    try {
      const ts: unknown = JSON.parse(config);
      const options = (ts && typeof ts === "object" && "compilerOptions" in ts ? ts.compilerOptions : undefined) as Record<string, unknown> | undefined;
      if (options?.strict !== true || options?.jsx !== "preserve" || options?.jsxImportSource !== "@zaakiyjs/core") {
        issues.push(diagnostic("INVALID_TS_CONFIG", "tsconfig.json must enable strict, jsx: preserve and jsxImportSource: @zaakiyjs/core."));
      }
    } catch {issues.push(diagnostic("INVALID_TS_CONFIG", "tsconfig.json is not valid JSON."));}
  }
  const vite = await textFile(join(cwd, "vite.config.ts"));
  if (vite !== undefined && (!vite.includes("zaakiyPlugin") || !vite.includes("@zaakiyjs/vite-plugin"))) {
    issues.push(diagnostic("MISSING_VITE_PLUGIN", "vite.config.ts must import and register zaakiyPlugin()."));
  }
  const packageText = await textFile(join(cwd, "package.json"));
  let manifest: Record<string, unknown> = {};
  try {
    if (packageText) manifest = JSON.parse(packageText) as Record<string, unknown>;
  } catch {issues.push(diagnostic("INVALID_PACKAGE_JSON", "package.json is invalid JSON."));}
  const declared = {...(manifest.dependencies as Record<string, string> | undefined),
    ...(manifest.devDependencies as Record<string, string> | undefined)};
  const scripts = manifest.scripts as Record<string, string> | undefined;
  for (const script of ["dev", "build", "test"]) {
    if (!scripts || typeof scripts[script] !== "string" || !scripts[script].trim()) {
      issues.push(diagnostic("MISSING_SCRIPT", "package.json has no executable " + script + " script."));
    }
  }
  const projectRequire = createRequire(join(cwd, "package.json"));
  for (const name of packages) {
    const specifier = "@zaakiyjs/" + name;
    if (typeof declared[specifier] !== "string") {
      issues.push(diagnostic("MISSING_DEPENDENCY", "Missing " + specifier + " dependency declaration."));
      continue;
    }
    try {
      projectRequire.resolve(specifier);
    } catch {
      issues.push(diagnostic("INVALID_PACKAGE_EXPORT", specifier + " is not installed or its main export cannot be resolved."));
    }
  }
  return issues;
}
