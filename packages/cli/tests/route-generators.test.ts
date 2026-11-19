import {afterEach, describe, expect, it} from "vitest";
import {mkdtemp, readFile, rm, stat, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import ts from "typescript";
import {runCli} from "../src/index.js";
import {generatorPlan} from "../src/generators.js";
import {CliError} from "../src/args.js";

const roots: string[] = [];
async function project(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "zaakiy-route-generators-"));
  roots.push(root);
  await writeFile(join(root, "package.json"), JSON.stringify({
    name: "route-generator-fixture", dependencies: {"@zaakiyjs/core": "workspace:^"}
  }));
  return root;
}
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, {recursive: true, force: true});
});
function capture(root: string) {
  let stdout = "", stderr = "";
  return {
    io: {cwd: root, stdout: (s: string) => {stdout += s;},
      stderr: (s: string) => {stderr += s;}},
    get stdout() {return stdout;},
    get stderr() {return stderr;}
  };
}

describe("CLI Router route/middleware/guard/loader generators", () => {
  it("generates deterministic TypeScript using only public Router contracts", () => {
    const expected: readonly [string, string, string][] = [
      ["route", "Orders", "src/routes/ordersRoute.ts"],
      ["guard", "Access", "src/guards/createAccessGuard.ts"],
      ["middleware", "Access", "src/guards/createAccessGuard.ts"],
      ["loader", "Orders", "src/loaders/createOrdersLoader.ts"]
    ];
    for (const [type, name, path] of expected) {
      const plan = generatorPlan(type, name);
      expect(plan).toHaveLength(1);
      expect(plan[0]?.path).toBe(path);
      expect(plan).toEqual(generatorPlan(type, name));
      const source = plan[0]!.content;
      expect(source).toContain('from "@zaakiyjs/router"');
      expect(source).not.toMatch(/from ["']react|from ["']vue|innerHTML|new Function|eval\(/);
      const transpiled = ts.transpileModule(source, {
        fileName: path, reportDiagnostics: true,
        compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext}
      });
      expect(transpiled.diagnostics?.filter(item => item.category === ts.DiagnosticCategory.Error) ?? []).toEqual([]);
    }
    expect(generatorPlan("middleware", "Access", undefined, undefined, "route"))
      .toEqual(generatorPlan("guard", "Access"));
    expect(generatorPlan("route", "Orders")[0]?.content).toContain('path: "/orders"');
    expect(generatorPlan("loader", "Orders")[0]?.content).toContain("context.signal.aborted");
    expect(generatorPlan("middleware", "Access")[0]?.content).toContain("allowed === true");
  });

  it("refuses unsupported middleware targets and generator option misuse", () => {
    expect(() => generatorPlan("middleware", "Auth", undefined, undefined, "proxy"))
      .toThrow(CliError);
    expect(() => generatorPlan("middleware", "Auth", undefined, undefined, "http"))
      .toThrow("Only middleware --target route");
    expect(() => generatorPlan("route", "Orders", undefined, undefined, "route"))
      .toThrow(CliError);
    expect(() => generatorPlan("middleware", "../escape")).toThrow(CliError);
    expect(() => generatorPlan("route", "Orders", "mvvm")).toThrow(CliError);
  });

  it("supports generator CLI, path safety, idempotency and explicit force", async () => {
    const root = await project();
    const preview = capture(root);
    expect(await runCli(["g", "middleware", "Auth", "--target", "route", "--dry-run"], preview.io)).toBe(0);
    expect(preview.stdout).toContain("src/guards/createAuthGuard.ts");
    await expect(stat(join(root, "src/guards/createAuthGuard.ts"))).rejects.toThrow();
    const normal = capture(root);
    expect(await runCli(["g", "middleware", "Auth", "--target", "route"], normal.io)).toBe(0);
    const path = join(root, "src/guards/createAuthGuard.ts");
    const previous = await readFile(path, "utf8");
    expect(previous).toContain("RouteGuard");
    const repeated = capture(root);
    expect(await runCli(["g", "guard", "Auth"], repeated.io)).toBe(0);
    expect(repeated.stdout).toContain("No changes");
    await writeFile(path, "// user's custom policy\n");
    const collision = capture(root);
    expect(await runCli(["g", "guard", "Auth"], collision.io)).toBe(1);
    expect(collision.stderr).toContain("FILE_EXISTS");
    expect(await readFile(path, "utf8")).toContain("custom policy");
    expect(await runCli(["g", "guard", "Auth", "--force"], capture(root).io)).toBe(0);
    expect(await readFile(path, "utf8")).toBe(previous);
    for (const args of [
      ["g", "middleware", "Auth", "--target", "proxy"],
      ["g", "middleware", "Auth", "--path", "../outside"],
      ["g", "route", "Home", "--target", "route"]
    ]) {
      const call = capture(root);
      expect(await runCli(args, call.io)).toBe(1);
      expect(call.stderr).toMatch(/UNSUPPORTED_TARGET|UNSAFE_PATH/);
    }
    expect(await runCli(["g", "route", "Reports"], capture(root).io)).toBe(0);
    expect(await runCli(["g", "loader", "Reports"], capture(root).io)).toBe(0);
    expect(await readFile(join(root, "src/routes/reportsRoute.ts"), "utf8"))
      .toContain("defineRoute");
    expect(await readFile(join(root, "src/loaders/createReportsLoader.ts"), "utf8"))
      .toContain("gateway.load(context)");
  });
});
