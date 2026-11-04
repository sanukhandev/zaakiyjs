import {spawn, spawnSync} from "node:child_process";
import {readFile, stat} from "node:fs/promises";
import {resolve, join} from "node:path";
import {CliError, parseArgs, assertOptions, flagOption, valueOption} from "./args.js";
import {diagnoseProject} from "./doctor.js";
import {generateFiles, supportedGenerators} from "./generators.js";
import {safeRelativePath} from "./fs-safe.js";
import {assertFrameworkReady, getInstalledVersions, parsePreset, scaffoldProject, type Versions} from "./scaffold.js";
import type {CliIO} from "./types.js";

export type {CliCommandName, CliInvocation, CliDiagnostic, CliResult, CliIO} from "./types.js";
export {CliError, parseArgs} from "./args.js";
export {validateProjectName} from "./fs-safe.js";
export {diagnoseProject} from "./doctor.js";
export {generatorPlan, supportedGenerators} from "./generators.js";
export {scaffoldPlan, scaffoldProject, parsePreset} from "./scaffold.js";
export const foundationStatus = {package: "@zaakiyjs/cli", implemented: true} as const;

const help = [
  "ZaakiyJS CLI — compiler-first TypeScript/TSX tooling",
  "Usage:",
  "  zaakiy start --project <name> [--template minimal|standard|enterprise]",
  "  zaakiy generate <type> <name> [--architecture mvvm] [--path folder]",
  "  zaakiy g <type> <name>",
  "  zaakiy dev | build | test",
  "  zaakiy doctor [--json]",
  "Options: --dry-run, --force, --path, --package-manager npm|pnpm|yarn, --workspace",
  "Generators: " + supportedGenerators().join(", "),
  "Deferred: page, layout, store, resource, task, interceptor, proxy, analyze, migrate, seo, ai",
  "Use --help for help and --version for the installed CLI version."
].join("\n") + "\n";

async function cliVersion(): Promise<string> {
  const manifest: unknown = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  if (manifest && typeof manifest === "object" && "version" in manifest && typeof manifest.version === "string") return manifest.version;
  throw new CliError("INVALID_PACKAGE", "CLI package.json is missing its version");
}
function packageManager(preferred?: string): "npm" | "pnpm" | "yarn" {
  const manager = preferred ?? (process.env.npm_config_user_agent?.split("/")[0] ?? "npm");
  if (manager !== "npm" && manager !== "pnpm" && manager !== "yarn") {
    throw new CliError("INVALID_PACKAGE_MANAGER", "Supported package managers: npm, pnpm, yarn.");
  }
  const program = process.platform === "win32" ? manager + ".cmd" : manager;
  const result = spawnSync(program, ["--version"], {encoding: "utf8", shell: process.platform === "win32"});
  if (result.error || result.status !== 0) throw new CliError("MISSING_PACKAGE_MANAGER", manager + " executable is unavailable.");
  const major = Number((result.stdout ?? "").trim().split(".")[0]);
  const minimum = manager === "pnpm" ? 10 : manager === "yarn" ? 4 : 10;
  if (!Number.isInteger(major) || major < minimum) throw new CliError("UNSUPPORTED_PACKAGE_MANAGER", manager + " " + minimum + "+ is required.");
  return manager;
}
export async function runProjectScript(command: "dev" | "build" | "test", cwd: string, manager: "npm" | "pnpm" | "yarn"): Promise<number> {
  let manifest: unknown;
  try {manifest = JSON.parse(await readFile(join(cwd, "package.json"), "utf8"));}
  catch {throw new CliError("INVALID_PROJECT", "Cannot read a valid package.json from " + cwd);}
  const scripts = manifest && typeof manifest === "object" && "scripts" in manifest ? manifest.scripts : undefined;
  if (!scripts || typeof scripts !== "object" || !(command in scripts) ||
    typeof (scripts as Record<string, unknown>)[command] !== "string" ||
    !(scripts as Record<string, string>)[command]?.trim()) {
    throw new CliError("MISSING_SCRIPT", "Project has no " + command + " script. Add a real toolchain script to package.json.");
  }
  const executable = process.platform === "win32" ? manager + ".cmd" : manager;
  return new Promise<number>((resolvePromise, rejectPromise) => {
    const child = spawn(executable, ["run", command], {cwd, stdio: "inherit", shell: process.platform === "win32"});
    const onInterrupt = () => {child.kill("SIGINT");};
    const onTermination = () => {child.kill("SIGTERM");};
    process.on("SIGINT", onInterrupt);
    process.on("SIGTERM", onTermination);
    const cleanup = () => {
      process.off("SIGINT", onInterrupt);
      process.off("SIGTERM", onTermination);
    };
    child.once("error", error => {cleanup(); rejectPromise(new CliError("SPAWN_FAILURE", String(error)));});
    child.once("exit", (code, signal) => {
      cleanup();
      resolvePromise(code ?? (signal === "SIGINT" ? 130 : signal === "SIGTERM" ? 143 : 1));
    });
  });
}
async function ensureProjectDirectory(cwd: string): Promise<void> {
  try {
    const info = await stat(join(cwd, "package.json"));
    if (!info.isFile()) throw new Error("not a regular file");
    const manifest: unknown = JSON.parse(await readFile(join(cwd, "package.json"), "utf8"));
    const dependencies = manifest && typeof manifest === "object" && "dependencies" in manifest ? manifest.dependencies : undefined;
    if (!dependencies || typeof dependencies !== "object" || !("@zaakiyjs/core" in dependencies)) throw new Error("missing @zaakiyjs/core dependency");
  } catch (error) {throw new CliError("NOT_ZAAKIY_PROJECT", "Run this command inside a ZaakiyJS project: " + String(error));}
}
export async function runCli(argv: readonly string[], io?: Partial<CliIO>): Promise<number> {
  const out = io?.stdout ?? (message => {process.stdout.write(message);});
  const err = io?.stderr ?? (message => {process.stderr.write(message);});
  const root = io?.cwd ?? process.cwd();
  try {
    const args = parseArgs(argv);
    if (args.command === "help" || flagOption(args.options, "help") || (!args.command && !flagOption(args.options, "version"))) {
      out(help);
      return 0;
    }
    if (flagOption(args.options, "version") || args.command === "version") {
      out((await cliVersion()) + "\n");
      return 0;
    }
    if (args.command === "start") {
      assertOptions(args, ["project", "template", "path", "package-manager", "dry-run", "force", "workspace"], 0);
      const name = valueOption(args.options, "project");
      if (!name) throw new CliError("MISSING_PROJECT", "Use: zaakiy start --project <name>.");
      const preset = parsePreset(valueOption(args.options, "template"));
      const manager = packageManager(valueOption(args.options, "package-manager"));
      const dryRun = flagOption(args.options, "dry-run");
      const workspace = flagOption(args.options, "workspace");
      if (workspace) {
        try {await stat(join(root, "pnpm-workspace.yaml"));}
        catch {throw new CliError("NO_WORKSPACE", "--workspace requires pnpm-workspace.yaml in the current directory.");}
      }
      if (!dryRun) await assertFrameworkReady();
      const simulated = {core: "workspace:^", dom: "workspace:^", signals: "workspace:^", styles: "workspace:^", "vite-plugin": "workspace:^"} satisfies Versions;
      const versions = dryRun ? simulated : await getInstalledVersions(workspace);
      const created = await scaffoldProject({
        cwd: root, name, preset, manager, versions,
        outputPath: valueOption(args.options, "path"), dryRun, force: flagOption(args.options, "force")
      });
      out((dryRun ? "Would create" : "Created") + " " + created.length + " files:\n" + created.map(path => "  " + path).join("\n") + "\n");
      if (!dryRun) out("Install explicitly: cd " + name + " && " + manager + " install && " + manager + " run dev\n");
      return 0;
    }
    if (args.command === "generate" || args.command === "g") {
      assertOptions(args, ["architecture", "path", "dry-run", "force"], 2);
      const [type, name] = args.positionals;
      if (!type || !name) throw new CliError("MISSING_ARGUMENT", "Use: zaakiy generate <type> <name>.");
      await ensureProjectDirectory(root);
      const created = await generateFiles({
        type, name, cwd: root, path: valueOption(args.options, "path"),
        architecture: valueOption(args.options, "architecture"),
        dryRun: flagOption(args.options, "dry-run"), force: flagOption(args.options, "force")
      });
      out(created.length === 0 ? "No changes: generated files are already up to date.\n" : (flagOption(args.options, "dry-run") ? "Would generate" : "Generated") + ":\n" + created.map(path => "  " + path).join("\n") + "\n");
      return 0;
    }
    if (args.command === "dev" || args.command === "build" || args.command === "test") {
      assertOptions(args, ["cwd", "package-manager"], 0);
      const relative = valueOption(args.options, "cwd");
      const cwd = relative ? resolve(root, safeRelativePath(relative)) : root;
      await ensureProjectDirectory(cwd);
      return runProjectScript(args.command, cwd, packageManager(valueOption(args.options, "package-manager")));
    }
    if (args.command === "doctor") {
      assertOptions(args, ["cwd", "json"], 0);
      const relative = valueOption(args.options, "cwd");
      const cwd = relative ? resolve(root, safeRelativePath(relative)) : root;
      const issues = await diagnoseProject(cwd);
      if (flagOption(args.options, "json")) out(JSON.stringify({ok: !issues.some(item => item.severity === "error"), diagnostics: issues}, null, 2) + "\n");
      else out(issues.length ? issues.map(item => item.severity.toUpperCase() + " " + item.code + ": " + item.message).join("\n") + "\n" : "No project diagnostics found.\n");
      return issues.some(item => item.severity === "error") ? 1 : 0;
    }
    if (["analyze", "migrate", "seo", "ai"].includes(args.command)) throw new CliError("COMMAND_UNAVAILABLE", args.command + " is planned but not implemented; no work was performed.");
    throw new CliError("UNKNOWN_COMMAND", "Unknown command " + args.command + ". Run zaakiy --help.");
  } catch (error) {
    if (error instanceof CliError) {
      err(error.code + ": " + error.message + "\n");
      return error.exitCode;
    }
    err("CLI_FAILURE: " + String(error) + "\n");
    return 1;
  }
}
