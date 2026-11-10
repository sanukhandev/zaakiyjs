import { describe, expect, it } from "vitest";
import { compile, parseToIR, validateIR } from "../src/index.js";

const fileName = "packages/compiler/test/slots-v2.tsx";
const source = [
  'import type { JSXChild } from "@zaakiyjs/core/jsx-runtime";',
  "function Panel(props: { children?: JSXChild }) {",
  '  return <section class="panel"><div>{props.children}</div></section>;',
  "}",
  "function App() {",
  '  return <main><Panel><button type="button">Open</button></Panel></main>;',
  "}"
].join("\n");
const opts = { fileName, source, componentSlots: true as const };

describe("opt-in component JSX children IR v2", () => {
  it("generates a one-shot owned native slot factory and a default slot outlet", () => {
    const result = compile(opts);
    expect(result.irVersion).toBe(2);
    expect(result.diagnostics.filter(d => d.severity === "error")).toEqual([]);
    expect(result.js).toHaveLength(1);
    const code = result.js[0]!.code;
    expect(code).toContain("createOwnedNativeSlot");
    expect(code).toContain("mountOwnedSlot");
    expect(code).toContain('"children": ');
    expect(code).not.toContain("react/jsx-runtime");
    expect(result.manifest?.irVersion).toBe(2);
    expect(compile(opts).js).toEqual(result.js);
  });

  it("preserves frozen v1 behavior and rejects accidental v2 fields in serialized v1 IR", () => {
    const original = compile({ fileName, source });
    expect(original.irVersion).toBe(1);
    expect(original.js).toHaveLength(0);
    expect(original.diagnostics.some(d => d.code === "ZC2102")).toBe(true);
    const v1Simple = compile({
      fileName, source: 'function App() { return <main><button>Safe</button></main>; }'
    });
    expect(v1Simple.irVersion).toBe(1);
    expect(v1Simple.diagnostics.filter(d => d.severity === "error")).toEqual([]);
    expect(v1Simple.js[0]?.code).not.toContain("createOwnedNativeSlot");

    const parsed = parseToIR(opts);
    expect(parsed.document.irVersion).toBe(2);
    expect(validateIR(parsed.document)).toEqual([]);
    const forged = { ...parsed.document, irVersion: 1 };
    expect(validateIR(forged).some(d => d.code === "ZC3004")).toBe(true);
    expect(validateIR({ ...parsed.document, irVersion: 3 }).some(d => d.code === "ZC3002")).toBe(true);
  });

  it("rejects an explicit children prop colliding with JSX children", () => {
    const conflicting = source.replace(
      '<Panel><button type="button">Open</button></Panel>',
      '<Panel children={"Other"}><button type="button">Open</button></Panel>'
    );
    const result = compile({ ...opts, source: conflicting });
    expect(result.js).toHaveLength(0);
    expect(result.diagnostics.some(d => d.code === "ZC2501")).toBe(true);
  });

  it("does not lower arbitrary or nested slot expressions", () => {
    const unsafe = source.replace('{props.children}', '{props.children || "fallback"}');
    const result = compile({ ...opts, source: unsafe });
    expect(result.js).toHaveLength(0);
    expect(result.diagnostics.some(d => d.code === "ZC2110" || d.code === "ZC2108")).toBe(true);
  });
});
