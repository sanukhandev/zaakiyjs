import { describe, expect, it } from "vitest";
import { compile, parseToIR, validateIR } from "../src/index.js";

const fileName = "packages/compiler/test/style-bindings.tsx";
const signal = 'declare function signal<T>(initial: T): { value: T };';

describe("opt-in IR v2 native style property lowering", () => {
  it("preserves IR v1 refusal and unrelated generated ABI imports", () => {
    const source = 'function App() { return <main style={{color: "red"}} />; }';
    const baseline = compile({fileName, source});
    expect(baseline.js).toHaveLength(0);
    expect(baseline.diagnostics.some(item => item.code === "ZC2204")).toBe(true);
    const unaffected = compile({fileName, source: "function App(){return <div />;}"});
    expect(unaffected.irVersion).toBe(1);
    expect(unaffected.js[0]?.code).not.toContain("bindStyle");
    expect(unaffected.js[0]?.code).not.toContain("setStyle");
  });

  it("compiles finite inline CSS properties to isolated DOM writes without style attribute injection", () => {
    const source = 'function App() { return <main style={{color: "red", backgroundColor: "blue", "--accent": "green"}} />; }';
    const result = compile({fileName, source, styleBindings: true});
    expect(result.diagnostics.filter(item => item.severity === "error")).toEqual([]);
    expect(result.irVersion).toBe(2);
    const ir = parseToIR({fileName, source, styleBindings: true}).document;
    expect(validateIR(ir)).toEqual([]);
    const root = ir.nodes.find(node => node.kind === "StaticElement");
    expect(root?.kind).toBe("StaticElement");
    if (root?.kind !== "StaticElement") return;
    const bindings = root.children.filter(node => node.kind === "PropertyBinding");
    expect(bindings.map(node => node.kind === "PropertyBinding" ? node.name : "")).toEqual([
      "color", "background-color", "--accent"
    ]);
    const js = result.js[0]?.code ?? "";
    expect(js).toContain("setStyle");
    expect(js).not.toMatch(/setAttribute\([^\n]*"style"/);
    expect(js).not.toContain("style.cssText");
    expect(js).not.toContain("innerHTML");
  });

  it("binds each reactive style independently and supports explicit removal", () => {
    const source = [
      signal,
      'function App() { const visible = signal(true); const color = signal("red");',
      'return <main style={{color: color.value, opacity: visible.value ? "1" : null, marginTop: "4px"}} />; }'
    ].join("\n");
    const result = compile({fileName, source, styleBindings: true});
    expect(result.diagnostics.filter(item => item.severity === "error")).toEqual([]);
    const js = result.js[0]?.code ?? "";
    expect(js).toContain("bindStyle");
    expect(js).toContain("setStyle");
    expect(js.match(/__zBindStyle\(/g)?.length).toBe(2);
    expect(js.match(/__zSetStyle\(/g)?.length).toBe(1);
  });

  it.each([
    ['style="color:red"', "ZC2610"],
    ["style={styles}", "ZC2610"],
    ['style={{...more}}', "ZC2611"],
    ['style={{["color"]: "red"}}', "ZC2611"],
    ['style={{color: "red", color: "blue"}}', "ZC2611"],
    ['style={{behavior: "red"}}', "ZC2611"],
    ['style={{color: "url(javascript:alert(1))"}}', "ZC2612"],
    ['style={{opacity: 0.5}}', "ZC2613"],
    ['style={{color: getColor()}}', "ZC2612"]
  ])("fails closed on unsafe inline style %s", (attribute, diagnostic) => {
    const result = compile({fileName,
      source: 'declare const more: unknown; declare const styles: unknown; declare function getColor(): string; function App(){return <div ' + attribute + ' />; }',
      styleBindings: true
    });
    expect(result.js).toHaveLength(0);
    expect(result.diagnostics.some(item => item.code === diagnostic)).toBe(true);
  });

  it("rejects unsafe untrusted IR v1/v2 style bindings", () => {
    const source = 'function App(){return <div style={{color: "red"}} />;}';
    const parsed = parseToIR({fileName, source, styleBindings: true}).document;
    expect(validateIR({...parsed, irVersion: 1}).some(item => item.code === "ZC3004")).toBe(true);
    const copied = structuredClone(parsed);
    const root = copied.nodes.find(node => node.kind === "StaticElement");
    expect(root?.kind).toBe("StaticElement");
    if (root?.kind !== "StaticElement") return;
    const prop = root.children.find(node => node.kind === "PropertyBinding");
    expect(prop?.kind).toBe("PropertyBinding");
    if (prop?.kind === "PropertyBinding") {
      const malformed = {...prop, name:"constructor"};
      const invalid = { ...copied, nodes: [{...root, children: [malformed]}] };
      expect(validateIR(invalid).some(item => item.code === "ZC3004")).toBe(true);
    }
  });
});
