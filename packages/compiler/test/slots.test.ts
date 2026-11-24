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


describe("opt-in named JSX prop slots", () => {
  const namedSource = [
    'import { Slot } from "@zaakiyjs/core";',
    'import type { JSXChild } from "@zaakiyjs/core/jsx-runtime";',
    'function Panel(props: { header?: JSXChild; children?: JSXChild }) {',
    '  return <section><Slot name="header" /><div>{props.children}</div></section>;',
    '}',
    'function App() {',
    '  return <main><Panel header={<h2 class="title">Title</h2>}><button>Open</button></Panel></main>;',
    '}'
  ].join("\n");

  it("lowers named JSX prop values into caller-owned one-shot slot factories", () => {
    const result = compile({ fileName, source: namedSource, componentSlots: true });
    expect(result.irVersion).toBe(2);
    expect(result.diagnostics.filter(d => d.severity === "error")).toEqual([]);
    expect(result.js).toHaveLength(1);
    const js = result.js[0]!.code;
    expect(js).toContain("createOwnedNativeSlot");
    expect(js).toContain("mountOwnedSlot");
    expect(js).toContain('"header": ');
    expect(js).toContain('props["header"]');
    expect(js).not.toContain("react/jsx-runtime");
    expect(result.manifest?.styleTokens).toContain("title");
    const parsed = parseToIR({ fileName, source: namedSource, componentSlots: true });
    expect(validateIR(parsed.document)).toEqual([]);
  });

  it("continues to reject named slot syntax in default v1 and dynamic name props", () => {
    const old = compile({ fileName, source: namedSource });
    expect(old.js).toHaveLength(0);
    expect(old.diagnostics.some(d => d.severity === "error")).toBe(true);

    const badName = namedSource.replace('name="header"', 'name={"header"}');
    const bad = compile({ fileName, source: badName, componentSlots: true });
    expect(bad.js).toHaveLength(0);
    expect(bad.diagnostics.some(d => d.code === "ZC2503")).toBe(true);
  });

  it("rejects duplicate named slot assignments and prototype-like names", () => {
    const duplicate = namedSource.replace(
      'header={<h2 class="title">Title</h2>}',
      'header={<h2>Title</h2>} header={<strong>Duplicate</strong>}'
    );
    const a = compile({ fileName, source: duplicate, componentSlots: true });
    expect(a.js).toHaveLength(0);
    expect(a.diagnostics.some(d => d.code === "ZC2504")).toBe(true);
    const malicious = namedSource.replace('name="header"', 'name="__proto__"');
    const b = compile({ fileName, source: malicious, componentSlots: true });
    expect(b.js).toHaveLength(0);
    expect(b.diagnostics.some(d => d.code === "ZC2503")).toBe(true);
  });
});
