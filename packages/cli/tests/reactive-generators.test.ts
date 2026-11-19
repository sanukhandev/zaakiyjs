import {afterEach, describe, expect, it} from "vitest";
import {mkdtemp, readFile, rm, stat, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import ts from "typescript";
import {runCli} from "../src/index.js";
import {generatorPlan} from "../src/generators.js";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, {recursive: true, force: true});
});
async function project(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "zaakiy-reactive-generator-"));
  roots.push(root);
  await writeFile(join(root, "package.json"), JSON.stringify({
    name: "reactive-generator-fixture", dependencies: {"@zaakiyjs/core": "workspace:^"}
  }));
  return root;
}
function run(root: string) {
  let stdout = "", stderr = "";
  return {
    io: {cwd: root, stdout: (line: string) => {stdout += line;},
      stderr: (line: string) => {stderr += line;}},
    get stdout() {return stdout;},
    get stderr() {return stderr;}
  };
}

describe("CLI reactive generators", () => {
  it("produces deterministic, syntactically valid native reactive TypeScript", () => {
    const cases: readonly [string, string, string][] = [
      ["signal", "Counter", "src/signals/createCounterSignal.ts"],
      ["customsignal", "Counter", "src/signals/createCounterSignal.ts"],
      ["custom-signal", "Counter", "src/signals/createCounterSignal.ts"],
      ["computed", "Counter", "src/signals/createCounterComputed.ts"],
      ["effect", "Counter", "src/effects/registerCounterEffect.ts"]
    ];
    for (const [type, name, file] of cases) {
      const result = generatorPlan(type, name);
      expect(result).toHaveLength(1);
      expect(result[0]?.path).toBe(file);
      expect(result).toEqual(generatorPlan(type, name));
      const source = result[0]!.content;
      expect(source).toContain("@zaakiyjs/signals");
      expect(source).not.toMatch(/from "react"|from "vue"|from "zone.js"|eval\(/);
      const output = ts.transpileModule(source, {
        fileName: file, compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext},
        reportDiagnostics: true
      });
      expect(output.diagnostics?.filter(d => d.category === ts.DiagnosticCategory.Error) ?? []).toEqual([]);
      if (type === "computed") expect(source).toContain("return computed(() => source.value * 2)");
      if (type === "effect") {
        expect(source).toContain('import {ownEffect} from "@zaakiyjs/core"');
        expect(source).toContain("ownEffect(() => effect(");
      }
    }
    expect(generatorPlan("customsignal", "Cart")).toEqual(generatorPlan("custom-signal", "Cart"));
    expect(generatorPlan("effect", "Cart", undefined, "src/custom")[0]?.path)
      .toBe("src/custom/registerCartEffect.ts");
  });

  it("writes idempotently, supports --dry-run, and preserves user changes without --force", async () => {
    const root = await project();
    const preview = run(root);
    expect(await runCli(["g", "effect", "Counter", "--dry-run"], preview.io)).toBe(0);
    expect(preview.stdout).toContain("src/effects/registerCounterEffect.ts");
    await expect(stat(join(root, "src/effects/registerCounterEffect.ts"))).rejects.toThrow();
    const output = run(root);
    expect(await runCli(["g", "effect", "Counter"], output.io)).toBe(0);
    const path = join(root, "src/effects/registerCounterEffect.ts");
    const original = await readFile(path, "utf8");
    expect(original).toContain("ownEffect");
    const repeated = run(root);
    expect(await runCli(["g", "effect", "Counter"], repeated.io)).toBe(0);
    expect(repeated.stdout).toContain("No changes");
    await writeFile(path, "// user-edited file\n");
    const collision = run(root);
    expect(await runCli(["g", "effect", "Counter"], collision.io)).toBe(1);
    expect(collision.stderr).toContain("FILE_EXISTS");
    expect(await readFile(path, "utf8")).toBe("// user-edited file\n");
    expect(await runCli(["g", "effect", "Counter", "--force"], run(root).io)).toBe(0);
    expect(await readFile(path, "utf8")).toBe(original);
  });
});
