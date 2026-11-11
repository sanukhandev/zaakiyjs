import { mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { compile, createCompilerSession } from "../src/index.js";

const directories: string[] = [];
async function fixture() {
  // A child of the workspace resolves the same typed JSX dependencies as Vite.
  const dir = await mkdtemp(join(resolve("."), ".zaakiy-compiler-session-"));
  directories.push(dir);
  return dir;
}
afterEach(async () => {
  await Promise.all(directories.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
});
const errors = (result: ReturnType<typeof compile>) =>
  result.diagnostics.filter(d => d.severity === "error");
const sameAsStandalone = (
  session: ReturnType<typeof createCompilerSession>, fileName: string, source: string,
  componentSlots?: boolean
) => {
  const request = { fileName, source, ...(componentSlots ? { componentSlots: true } : {}) };
  const candidate = session.compile(request);
  const frozen = compile(request);
  expect(candidate).toEqual(frozen);
  return candidate;
};

describe("project-scoped TypeScript diagnostics", () => {
  it("matches standalone generated code, maps and diagnostic text for independent TSX files", async () => {
    const dir = await fixture();
    const session = createCompilerSession(dir);
    try {
      for (let i = 0; i < 8; i++) {
        const fileName = join(dir, "component-" + i + ".tsx");
        const source = "function App() { const count = " + i +
          "; return <div>{count}</div>; }";
        const result = sameAsStandalone(session, fileName, source);
        expect(errors(result)).toEqual([]);
        expect(result.js[0]?.map).toBeTruthy();
      }
    } finally { session.dispose(); }
  });

  it("invalidates imported type changes and deletion without stale diagnostics", async () => {
    const dir = await fixture();
    const typeFile = join(dir, "types.ts");
    const fileName = join(dir, "app.tsx");
    const source = [
      'import type { Thing } from "./types.js";',
      'function App() { const data: Thing = { name: "valid" };',
      ' return <main>{data.name}</main>; }'
    ].join("\n");
    await writeFile(typeFile, "export interface Thing { name: string }\n");
    const session = createCompilerSession(dir);
    try {
      expect(errors(sameAsStandalone(session, fileName, source))).toEqual([]);
      await writeFile(typeFile, "export interface Thing { name: number }\n");
      session.invalidate(typeFile);
      const mismatch = sameAsStandalone(session, fileName, source);
      expect(errors(mismatch).some(d => d.code === "ZCTS2322")).toBe(true);
      await unlink(typeFile);
      session.invalidate(typeFile);
      const missing = sameAsStandalone(session, fileName, source);
      expect(errors(missing).some(d => d.code === "ZCTS2307")).toBe(true);
      await writeFile(typeFile, "export interface Thing { name: string }\n");
      session.invalidate(typeFile);
      expect(errors(sameAsStandalone(session, fileName, source))).toEqual([]);
    } finally { session.dispose(); }
  });

  it("updates the root source version and preserves custom JSX text type errors", async () => {
    const dir = await fixture();
    const session = createCompilerSession(dir);
    const file = join(dir, "app.tsx");
    try {
      const valid = "function App() { return <p>{42}</p>; }";
      expect(errors(sameAsStandalone(session, file, valid))).toEqual([]);
      const invalid = "function App() { const data = {id:1}; return <p>{data}</p>; }";
      const result = sameAsStandalone(session, file, invalid);
      expect(errors(result).some(d => d.code === "ZC2110")).toBe(true);
      expect(result.js).toHaveLength(0);
      expect(errors(sameAsStandalone(session, file, valid))).toEqual([]);
    } finally { session.dispose(); }
  });

  it("isolates two project sessions and rejects use after disposal", async () => {
    const first = await fixture();
    const second = await fixture();
    const a = createCompilerSession(first);
    const b = createCompilerSession(second);
    const fileA = join(first, "app.tsx"), fileB = join(second, "app.tsx");
    try {
      const outputA = sameAsStandalone(a, fileA, "function App() { return <p>first</p>; }");
      const outputB = sameAsStandalone(b, fileB, "function App() { return <p>second</p>; }");
      expect(outputA.js[0]?.code).not.toBe(outputB.js[0]?.code);
    } finally { a.dispose(); b.dispose(); }
    expect(() => a.compile({ fileName: fileA, source: "export const x = 1;" })).toThrow(/disposed/);
    expect(() => b.invalidate(fileB)).toThrow(/disposed/);
    expect(() => a.dispose()).not.toThrow();
  });

  it("keeps unsupported explicit browser targets fail-closed", async () => {
    const dir = await fixture();
    const session = createCompilerSession(dir);
    try {
      const request = { fileName: join(dir,"app.tsx"), source: "function App(){return <p/>;}",
        targetBrowsers: ["ie 11"] };
      expect(session.compile(request)).toEqual(compile(request));
      expect(errors(session.compile(request)).some(d=>d.code==="ZC2301")).toBe(true);
    } finally { session.dispose(); }
  });
});
