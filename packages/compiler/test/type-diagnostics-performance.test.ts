import {describe, expect, it} from "vitest";
import {compile} from "../src/index.js";

const fileName = "packages/compiler/test/type-diagnostics-performance.fixture.tsx";
const compileSource = (source: string) => compile({fileName, source});

describe("targeted TypeScript compiler diagnostic scope", () => {
  it("preserves semantic errors in the TSX file rather than bypassing type safety", () => {
    const result = compileSource('const n: number = "wrong"; function App(){return <div>{n}</div>;}');
    expect(result.js).toHaveLength(0);
    expect(result.diagnostics.some(item =>
      item.severity === "error" && item.code === "ZCTS2322")).toBe(true);
  });
  it("retains strict JSX text-type rejection", () => {
    const result = compileSource('function App(){const obj = {value: 1}; return <span>{obj}</span>;}');
    expect(result.js).toHaveLength(0);
    expect(result.diagnostics.some(item =>
      item.severity === "error" && item.code === "ZC2110")).toBe(true);
  });
  it("compiles valid TSX with deterministic emitted JS across repeated calls", () => {
    const request = 'function App(){const n: number = 42; return <output>{n}</output>;}';
    const values = Array.from({length: 3}, () => compileSource(request));
    for (const result of values) {
      expect(result.diagnostics.filter(item => item.severity === "error")).toEqual([]);
      expect(result.js).toHaveLength(1);
    }
    expect(new Set(values.map(result => result.js[0]?.code)).size).toBe(1);
  });
});
