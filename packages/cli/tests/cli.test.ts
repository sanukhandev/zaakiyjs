import {afterEach, describe, expect, it} from "vitest";
import {mkdtemp, mkdir, readFile, rm, stat, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join, dirname} from "node:path";
import {fileURLToPath} from "node:url";
import {execFileSync} from "node:child_process";
import {runCli, runProjectScript} from "../src/index";
import {CliError, parseArgs} from "../src/args";
import {generatorPlan, generateFiles} from "../src/generators";
import {safeRelativePath, validateProjectName} from "../src/fs-safe";
import {assertFrameworkReady, getInstalledVersions, scaffoldPlan, scaffoldProject, type Versions} from "../src/scaffold";
import {diagnoseProject} from "../src/doctor";
const tempRoots: string[] = [];
const versions: Versions = {core: "workspace:^", dom: "workspace:^", signals: "workspace:^", styles: "workspace:^", "vite-plugin": "workspace:^"};
async function temp(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "zaakiy-cli-"));
  tempRoots.push(path);
  return path;
}
afterEach(async () => {
  for (const path of tempRoots.splice(0)) await rm(path, {recursive: true, force: true});
});
function capture(cwd: string) {
  let stdout = "", stderr = "";
  return {io: {cwd, stdout: (value: string) => {stdout += value;}, stderr: (value: string) => {stderr += value;}},
    output: () => ({stdout, stderr})};
}
describe("CLI commands", () => {
  it("renders actual help, version and unknown command diagnostics", async () => {
    const root = await temp();
    const c = capture(root);
    expect(await runCli(["--help"], c.io)).toBe(0);
    expect(c.output().stdout).toContain("start --project");
    const version = capture(root);
    expect(await runCli(["--version"], version.io)).toBe(0);
    expect(version.output().stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
    const unknown = capture(root);
    expect(await runCli(["create"], unknown.io)).toBe(1);
    expect(unknown.output().stderr).toContain("UNKNOWN_COMMAND");
    const deferred = capture(root);
    expect(await runCli(["ai"], deferred.io)).toBe(1);
    expect(deferred.output().stderr).toContain("COMMAND_UNAVAILABLE");
  });
  it("rejects unknown/repeated options and unsafe names", () => {
    expect(() => parseArgs(["start", "--project", "x", "--project", "y"])).toThrow("Repeated option");
    expect(() => parseArgs(["start", "--oops"])).toThrow("Unknown option");
    for (const value of ["Bad Name", "CON", "../escape", "test.", "", "foo/bar", "a--b"]) {
      expect(() => validateProjectName(value)).toThrow(CliError);
    }
    expect(validateProjectName("my-app")).toBe("my-app");
  });
  it("does not silently generate against M0 stubs", async () => {
    const root = await temp();
    const c = capture(root);
    expect(await runCli(["start", "--project", "my-app", "--template", "minimal"], c.io)).toBe(1);
    expect(c.output().stderr).toMatch(/FOUNDATION_NOT_READY|UNPUBLISHED_FRAMEWORK/);
    await expect(stat(join(root, "my-app"))).rejects.toThrow();
  });
  it("refuses workspace output outside the declared pnpm workspace globs", async () => {
    const root = await temp();
    await writeFile(join(root, "pnpm-workspace.yaml"), "packages:\n  - 'packages/*'\n");
    const c = capture(root);
    expect(await runCli(["start","--project","foo","--workspace","--package-manager","npm","--dry-run"],c.io)).toBe(1);
    expect(c.output().stderr).toContain("WORKSPACE_MANAGER");
    const other = capture(root);
    const code = await runCli(["start","--project","foo","--workspace","--package-manager","pnpm","--dry-run"], other.io);
    expect(code).toBe(1);
    expect(other.output().stderr).toContain("WORKSPACE_NOT_INCLUDED");
  });
  it("supports no-write dry run", async () => {
    const root = await temp();
    const c = capture(root);
    expect(await runCli(["start", "--project", "my-app", "--dry-run"], c.io)).toBe(0);
    expect(c.output().stdout).toContain("Would create");
    await expect(stat(join(root, "my-app"))).rejects.toThrow();
  });
});
describe("scaffold", () => {
  it("creates Minimal in a clean fixture and executes its Node test script", async () => {
    const root = await temp();
    const files = await scaffoldProject({cwd: root, name: "my-app", preset: "minimal", manager: "npm", versions, dryRun: false, force: false});
    expect(files).toContain("my-app/src/main.tsx");
    expect(files).toContain("my-app/.gitignore");
    expect(await readFile(join(root,"my-app","src/App.tsx"),"utf8")).toContain('from "@zaakiyjs/signals"');
    const manifest = JSON.parse(await readFile(join(root, "my-app", "package.json"), "utf8")) as {scripts: Record<string, string>};
    expect(manifest.scripts.build).toContain("vite build");
    expect(await runProjectScript("test", join(root, "my-app"), "npm")).toBe(0);
  });
  it("supports Standard and Enterprise without unimplemented imports", async () => {
    for (const preset of ["standard", "enterprise"] as const) {
      const planned = await scaffoldPlan("sample", preset, "npm", versions);
      expect(planned.some(file => file.path === "src/features/README.md")).toBe(true);
      expect(planned.some(file => file.content.includes("@zaakiyjs/router"))).toBe(false);
      if (preset === "enterprise") expect(planned.some(file => file.path === "src/app/providers/README.md")).toBe(true);
    }
  });
  it("rejects directory collisions, dry-run writes nothing, and --force replaces explicitly", async () => {
    const root = await temp();
    const input = {cwd: root, name: "sample", preset: "minimal" as const, manager: "npm", versions, dryRun: false, force: false};
    await scaffoldProject(input);
    await expect(scaffoldProject(input)).rejects.toThrow("already exists");
    await writeFile(join(root, "sample", "proof.txt"), "preserve");
    await scaffoldProject({...input, dryRun: true});
    expect(await readFile(join(root, "sample", "proof.txt"), "utf8")).toBe("preserve");
    await scaffoldProject({...input, force: true});
    await expect(stat(join(root, "sample", "proof.txt"))).rejects.toThrow();
  });
});
describe("generators", () => {
  it("emits SOLID MVVM dependency direction", () => {
    const files = generatorPlan("feature", "products", "mvvm");
    expect(files).toHaveLength(5);
    const model = files.find(file => file.path.includes("/model/"))?.content ?? "";
    const vm = files.find(file => file.path.includes("/viewmodel/"))?.content ?? "";
    const view = files.find(file => file.path.includes("/view/"))?.content ?? "";
    expect(model).not.toMatch(/View|@zaakiyjs|services/);
    expect(vm).toContain("ProductsRepository");
    expect(vm).toContain('@zaakiyjs/signals');
    expect(vm).not.toContain('from "@zaakiyjs/core"');
    expect(vm).not.toContain("/services/");
    expect(vm).toContain("AbortController");
    expect(vm).toContain("onCleanup");
    expect(vm).toContain("pending === controller");
    expect(view).toContain("ProductsViewModel");
    const adapter = files.find(file => file.path.includes("/adapters/"))?.content ?? "";
    expect(adapter).toContain("runWithOwner");
    expect(generatorPlan("viewmodel","Cart")[0]?.content).toContain('@zaakiyjs/signals');
    expect(generatorPlan("context","Session")[0]?.content).toContain("createContext");
    expect(generatorPlan("provider","Session")[0]?.content).toContain("provide");
  });
  it("handles component generation, conflicts, overrides, and idempotent dry-run", async () => {
    const root = await temp();
    await mkdir(join(root, "src"), {recursive: true});
    const options = {type: "component", name: "MyButton", cwd: root, dryRun: false, force: false};
    const files = await generateFiles(options);
    expect(files).toContain("src/components/MyButton.tsx");
    expect(await generateFiles(options)).toEqual([]); // identical repeat is idempotent
    expect(await generateFiles({...options, dryRun: true})).toEqual([]);
    await writeFile(join(root, files[0] ?? ""), "// user changes");
    await expect(generateFiles(options)).rejects.toThrow("different content");
    expect(await generateFiles({...options, dryRun: true})).toEqual(files);
    await generateFiles({...options, force: true});
    expect(await readFile(join(root, files[0] ?? ""), "utf8")).toContain("MyButtonProps");
  });
  it("rejects unsupported generators and traversal/Windows names", () => {
    expect(() => generatorPlan("proxy", "Api")).toThrow("not implemented");
    expect(() => generatorPlan("page", "Home")).toThrow("not implemented");
    expect(() => safeRelativePath("..\\secrets")).toThrow(CliError);
    expect(() => safeRelativePath("C:\\secrets")).toThrow(CliError);
    expect(() => safeRelativePath("src\\CON\\Foo.ts")).toThrow(CliError);
    expect(safeRelativePath("src\\components\\Button.tsx")).toBe("src/components/Button.tsx");
  });
});
describe("doctor and process delegation", () => {
  it("diagnoses absent project files and invalid exports", async () => {
    const root = await temp();
    const issues = await diagnoseProject(root);
    expect(issues.some(item => item.code === "MISSING_PROJECT_FILE")).toBe(true);
  });
  it("checks installed package exports without requiring CommonJS resolution", async () => {
    const root = await temp();
    const target = join(root, "node_modules", "@zaakiyjs", "core");
    await mkdir(target, {recursive: true});
    await writeFile(join(target, "package.json"), JSON.stringify({
      name: "@zaakiyjs/core", version: "0.2.0", type: "module",
      exports: {".": {import: "./dist/index.js", types: "./dist/index.d.ts"}}
    }));
    await scaffoldProject({cwd: root, name: "fixture", preset: "minimal", manager: "npm",
      versions, dryRun: false, force: false});
    const issues = await diagnoseProject(root);
    expect(issues.some(issue => issue.code === "MISSING_PROJECT_FILE")).toBe(true);
  });
  it("packs the built CLI with executable and templates and invokes the bin", async () => {
    const root = dirname(dirname(fileURLToPath(import.meta.url)));
    const pack = JSON.parse(execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
      cwd: root, encoding: "utf8"
    })) as Array<{files: Array<{path: string}>}>;
    const paths = (pack[0]?.files ?? []).map(file => file.path);
    expect(paths).toContain("dist/bin.js");
    expect(paths).toContain("templates/minimal/src/App.tsx");
    expect(paths).toContain("templates/minimal/gitignore.tmpl");
    const message = execFileSync(process.execPath, [join(root, "dist", "bin.js"), "--help"], {encoding: "utf8"});
    expect(message).toContain("zaakiy start --project");
  });
  it("forwards a subprocess nonzero exit code", async () => {
    const root = await temp();
    await writeFile(join(root, "package.json"), JSON.stringify({scripts: {test: "node -e \"process.exit(17)\""}}));
    expect(await runProjectScript("test", root, "npm")).toBe(17);
  });
  it.skipIf(process.env.ZAAKIY_CLEAN_BUILD !== "1")("runs clean installation, generated TS typecheck and Vite build after dependent packages are released", async () => {
    const root = await temp();
    await assertFrameworkReady();
    const releasedVersions = await getInstalledVersions(false);
    await scaffoldProject({cwd: root, name: "release-check", preset: "minimal", manager: "npm", versions: releasedVersions, dryRun: false, force: false});
    const {execFileSync} = await import("node:child_process");
    execFileSync("npm", ["install"], {cwd: join(root, "release-check"), stdio: "inherit"});
    execFileSync("npm", ["run", "typecheck"], {cwd: join(root, "release-check"), stdio: "inherit"});
    execFileSync("npm", ["run", "build"], {cwd: join(root, "release-check"), stdio: "inherit"});
  });
});
