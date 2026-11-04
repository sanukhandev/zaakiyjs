import {spawnSync} from "node:child_process";
import {readFile, stat} from "node:fs/promises";
import {join, resolve, sep} from "node:path";
import type {CliDiagnostic} from "./types.js";

const packages = ["core", "dom", "signals", "styles", "vite-plugin"] as const;
type JsonObject = Record<string, unknown>;

async function readText(path: string): Promise<string | undefined> {
  try { return await readFile(path, "utf8"); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}
function obj(value: unknown): JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
}
function failure(code: string, message: string, severity: CliDiagnostic["severity"] = "error"): CliDiagnostic {
  return {code, message, severity};
}
function currentNodeSupported(): boolean {
  const [major, minor] = process.versions.node.split(".").map(Number);
  return (major ?? 0) > 20 || ((major ?? 0) === 20 && (minor ?? 0) >= 19);
}
function findExportPath(value: unknown, condition: "import" | "types"): string | undefined {
  if (typeof value === "string") return value;
  const record = obj(value);
  const direct = record[condition] ?? record.default;
  return typeof direct === "string" ? direct : undefined;
}
async function inspectInstalled(cwd: string, name: string): Promise<CliDiagnostic[]> {
  const specifier = "@zaakiyjs/" + name;
  const prefix = resolve(cwd, "node_modules", "@zaakiyjs", name);
  const manifestPath = join(prefix, "package.json");
  const raw = await readText(manifestPath);
  if (!raw) return [failure("MISSING_INSTALLED_PACKAGE", specifier + " is not installed or has no package manifest.")];

  let info: JsonObject;
  try { info = obj(JSON.parse(raw) as unknown); }
  catch { return [failure("INVALID_INSTALLED_MANIFEST", specifier + "/package.json is not valid JSON.")]; }
  const result: CliDiagnostic[] = [];
  if (info.name !== specifier) result.push(failure("PACKAGE_NAME_MISMATCH", "Installed package name does not match " + specifier));
  if (typeof info.version !== "string" || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(info.version)) {
    result.push(failure("INVALID_PACKAGE_VERSION", "Installed " + specifier + " has invalid SemVer."));
  } else if (info.version === "0.0.0") {
    result.push(failure("FOUNDATION_NOT_READY", specifier + " is the M0 contract-only 0.0.0 version."));
  }
  const exportsRoot = obj(info.exports)["."] as unknown;
  for (const condition of ["import", "types"] as const) {
    const path = findExportPath(exportsRoot, condition);
    if (typeof path !== "string" || !path.startsWith("./")) {
      result.push(failure("INVALID_PACKAGE_EXPORT", specifier + " lacks a relative " + condition + " public export."));
      continue;
    }
    const absolute = resolve(prefix, path);
    if (!absolute.startsWith(prefix + sep)) {
      result.push(failure("INVALID_PACKAGE_EXPORT", specifier + " export escapes its package root."));
      continue;
    }
    try {
      if (!(await stat(absolute)).isFile()) throw new Error("not a file");
    } catch {
      result.push(failure("MISSING_PACKAGE_EXPORT", specifier + " " + condition + " export is missing on disk: " + path));
    }
  }
  return result;
}
export async function diagnoseProject(cwd: string): Promise<CliDiagnostic[]> {
  const issues: CliDiagnostic[] = [];
  if (!currentNodeSupported()) issues.push(failure("NODE_UNSUPPORTED", "Node.js 20.19 or newer is required."));

  const manager = process.env.npm_config_user_agent?.split("/")[0] ?? "npm";
  if (["npm", "pnpm", "yarn"].includes(manager)) {
    const command = process.platform === "win32" ? manager + ".cmd" : manager;
    const check = spawnSync(command, ["--version"], {encoding: "utf8", shell: process.platform === "win32"});
    const major = Number((check.stdout ?? "").trim().split(".")[0]);
    const minimum = manager === "pnpm" ? 10 : manager === "yarn" ? 4 : 10;
    if (check.status !== 0 || !Number.isInteger(major) || major < minimum) {
      issues.push(failure("PACKAGE_MANAGER_UNSUPPORTED", manager + " " + minimum + "+ is required."));
    }
  } else issues.push(failure("PACKAGE_MANAGER_UNKNOWN", "Unknown package manager: " + manager));

  const required = ["package.json", "tsconfig.json", "vite.config.ts", "zaakiy.config.ts",
    "index.html", "src/main.tsx", "src/App.tsx"];
  for (const filename of required) {
    try {
      if (!(await stat(join(cwd, filename))).isFile()) throw new Error("not a file");
    } catch {
      issues.push(failure("MISSING_PROJECT_FILE", "Missing required file: " + filename));
    }
  }

  const tsconfig = await readText(join(cwd, "tsconfig.json"));
  if (tsconfig !== undefined) {
    try {
      const options = obj(obj(JSON.parse(tsconfig) as unknown).compilerOptions);
      if (options.strict !== true || options.jsx !== "preserve" || options.jsxImportSource !== "@zaakiyjs/core") {
        issues.push(failure("INVALID_TS_CONFIG", "Use strict: true, jsx: preserve and jsxImportSource: @zaakiyjs/core."));
      }
    } catch {
      issues.push(failure("INVALID_TS_CONFIG", "tsconfig.json must be parseable JSON with strict TSX settings."));
    }
  }

  const vite = await readText(join(cwd, "vite.config.ts"));
  if (vite !== undefined && (!vite.includes("@zaakiyjs/vite-plugin") || !/\bzaakiyPlugin\s*\(/.test(vite))) {
    issues.push(failure("MISSING_VITE_PLUGIN", "vite.config.ts must register zaakiyPlugin from @zaakiyjs/vite-plugin."));
  }

  const manifest = await readText(join(cwd, "package.json"));
  if (!manifest) return issues;
  let pkg: JsonObject;
  try { pkg = obj(JSON.parse(manifest) as unknown); }
  catch {
    issues.push(failure("INVALID_PACKAGE_JSON", "package.json is not valid JSON."));
    return issues;
  }
  const declared: JsonObject = {...obj(pkg.dependencies), ...obj(pkg.devDependencies)};
  const scripts = obj(pkg.scripts);
  for (const script of ["dev", "build", "test"]) {
    if (typeof scripts[script] !== "string" || !String(scripts[script]).trim()) {
      issues.push(failure("MISSING_SCRIPT", "Missing executable project script: " + script));
    }
  }
  for (const name of packages) {
    const specifier = "@zaakiyjs/" + name;
    if (typeof declared[specifier] !== "string") {
      issues.push(failure("MISSING_DEPENDENCY", "Missing package dependency " + specifier));
      continue;
    }
    issues.push(...await inspectInstalled(cwd, name));
  }
  return issues;
}
