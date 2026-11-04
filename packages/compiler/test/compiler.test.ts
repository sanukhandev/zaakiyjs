import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { compile, parseToIR, validateIR } from "../src/index.js";

const fileName = "packages/compiler/test/fixture.tsx";
const signalDecl = "declare function signal<T>(value: T): { value: T };";
const counterSource = [
  signalDecl,
  "function Counter() {",
  " const count = signal(0);",
  " return <main><span>{count.value}</span><button onClick={() => count.value++}>Increment</button></main>;",
  "}"
].join("\n");

type FakeText = { data: string; kind: "text" };
type FakeElement = {
  tag: string; namespace: string; children: Array<FakeText | FakeElement>;
  properties: Record<string, unknown>; attributes: Record<string, string | null>;
  listeners: Record<string, (event: unknown) => void>;
  appendChild(child: FakeText | FakeElement): void;
};
type FakeNode = FakeText | FakeElement;

function execute(source: string, entry: string, globals: Record<string, unknown> = {}): { root: FakeNode; elements: FakeElement[] } {
  const compiled = compile({ fileName, source });
  expect(compiled.diagnostics.filter(d => d.severity === "error")).toEqual([]);
  const asset = compiled.js[0];
  expect(asset).toBeDefined();
  if (!asset) throw new Error("Compilation did not emit JS");
  const elements: FakeElement[] = [];
  let active: (() => void) | null = null;
  const signal = <T,>(initial: T) => {
    let value = initial;
    const observers = new Set<() => void>();
    return Object.defineProperty({}, "value", {
      get() {
        if (active) observers.add(active);
        return value;
      },
      set(next: T) {
        value = next;
        for (const run of [...observers]) run();
      },
      enumerable: true
    });
  };
  const bind = (apply: () => void) => {
    const run = () => {
      active = run;
      try { apply(); } finally { active = null; }
    };
    run();
  };
  const env = {
    signal,
    __zCreateElement(tag: string, namespace: string): FakeElement {
      const el: FakeElement = {
        tag, namespace, children: [], properties: {}, attributes: {}, listeners: {},
        appendChild(child) { this.children.push(child); }
      };
      elements.push(el);
      return el;
    },
    __zCreateText(data: string): FakeText { return { kind: "text", data }; },
    __zSetProperty(el: FakeElement, name: string, value: unknown) { el.properties[name] = value; },
    __zSetAttribute(el: FakeElement, name: string, value: string | null) { el.attributes[name] = value; },
    __zBindText(_owner: unknown, node: FakeText, read: () => unknown) {
      bind(() => { node.data = String(read() ?? ""); });
    },
    __zBindProperty(_owner: unknown, node: FakeElement, name: string, read: () => unknown) {
      bind(() => { node.properties[name] = read(); });
    },
    __zListen(_owner: unknown, node: FakeElement, name: string, fn: (event: unknown) => void) {
      node.listeners[name] = fn;
    },
    __zGetOwner() { return {}; },
    __zCreateOwner(parent: unknown) { return { parent }; },
    __zRunWithOwner(_owner: unknown, create: () => FakeNode) { return create(); },
  };
  const noImports = asset.code.split("\n")
    .filter(line => !line.trimStart().startsWith("import "))
    .join("\n").replace(/^export\s+/gm, "");
  const context = { ...env, ...globals, __fixture: undefined as (() => FakeNode) | undefined };
  runInNewContext(noImports + "\n__fixture = " + entry + ";", context, { timeout: 1000 });
  if (!context.__fixture) throw new Error("Missing fixture export: " + entry);
  return { root: context.__fixture(), elements };
}

function allText(node: FakeNode): string {
  return "kind" in node ? node.data : node.children.map(allText).join("");
}

describe("TSX-to-DOM compiler safe vertical slice", () => {
  it("emits static JSX and text with no virtual DOM or framework runtime imports", () => {
    const result = compile({ fileName, source: "function App() { return <main>Hello</main>; }" });
    expect(result.diagnostics.filter(d => d.severity === "error")).toEqual([]);
    expect(result.js).toHaveLength(1);
    expect(result.js[0]?.code).toContain('__zCreateElement("main", "html")');
    expect(result.js[0]?.code).toContain('__zCreateText("Hello")');
    expect(result.js[0]?.code).not.toMatch(/react\/jsx-runtime|react-dom|vue|angular|innerHTML|eval\(|new Function/);
    expect(allText(execute("function App() { return <main>Hello</main>; }", "App").root)).toBe("Hello");
  });

  it("updates only bound text and reuses existing nodes on signal changes", () => {
    const { root, elements } = execute(counterSource, "Counter");
    expect(elements.map(e => e.tag)).toEqual(["main", "span", "button"]);
    const span = elements[1];
    const button = elements[2];
    expect(span && allText(span)).toBe("0");
    button?.listeners.click?.({});
    expect(span && allText(span)).toBe("1");
    expect(allText(root)).toBe("1Increment");
    expect(elements).toHaveLength(3);
  });

  it("updates reactive DOM properties via bindProperty", () => {
    const source = [
      signalDecl,
      "function App() { const count = signal(5);",
      "return <main><input value={count.value} /><button onClick={() => count.value++}>+</button></main>; }"
    ].join("\n");
    const { elements } = execute(source, "App");
    const input = elements.find(el => el.tag === "input");
    const button = elements.find(el => el.tag === "button");
    expect(input?.properties.value).toBe(5);
    button?.listeners.click?.({});
    expect(input?.properties.value).toBe(6);
  });

  it("creates nested functional components only once in child ownership scopes", () => {
    const source = [
      "function Label(props: { name: string }) { return <span>{props.name}</span>; }",
      "function App() { return <main><Label name=\"Ada\" /></main>; }"
    ].join("\n");
    const { root, elements } = execute(source, "App");
    expect(allText(root)).toBe("Ada");
    expect(elements.map(e => e.tag)).toEqual(["main", "span"]);
    const result = compile({ fileName, source });
    expect(result.js[0]?.code).toContain("__zCreateOwner");
    expect(result.js[0]?.code).toContain("__zRunWithOwner");
  });

  it("lowers static conditionals but rejects dynamic owner-lifetime regions", () => {
    const yes = compile({ fileName, source: "function App() { return <main>{true ? <span>yes</span> : <span>no</span>}</main>; }" });
    expect(yes.diagnostics.filter(d => d.severity === "error")).toEqual([]);
    expect(allText(execute("function App() { return <main>{true ? <span>yes</span> : <span>no</span>}</main>; }", "App").root)).toBe("yes");
    const dynamic = compile({ fileName, source: [
      signalDecl,
      "function App() {const flag = signal(true); return <main>{flag.value ? <span>yes</span> : <span>no</span>}</main>; }"
    ].join("\n") });
    expect(dynamic.js).toHaveLength(0);
    expect(dynamic.diagnostics.some(d => d.code === "ZC2201")).toBe(true);
  });

  it("recognizes keyed maps in v1 IR and fails closed until the keyed-loop ABI is frozen", () => {
    const source = [
      "const items = [{ id: 1 }];",
      "function App() { return <main>{items.map(item => <span key={item.id}>{item.id}</span>)}</main>; }"
    ].join("\n");
    const parsed = parseToIR({ fileName, source });
    const root = parsed.document.nodes[0];
    expect(root?.kind).toBe("StaticElement");
    if (root?.kind !== "StaticElement") return;
    expect(root.children.some(node => node.kind === "KeyedLoop")).toBe(true);
    const result = compile({ fileName, source });
    expect(result.js).toHaveLength(0);
    expect(result.diagnostics.some(d => d.code === "ZC2202")).toBe(true);
  });

  it("evaluates untracked impure calls at component initialization, not in a binding", () => {
    const source = "declare function read(): string; function App() { return <span>{read()}</span>; }";
    const result = compile({ fileName, source });
    expect(result.diagnostics.filter(d => d.severity === "error")).toEqual([]);
    expect(result.js[0]?.code).not.toContain("__zBindText(__z_owner");
    let calls = 0;
    const { root } = execute(source, "App", {
      read: () => { calls++; return "once"; }
    });
    expect(allText(root)).toBe("once");
    expect(calls).toBe(1);
    expect(result.js[0]?.code.match(/read\(\)/g)?.length).toBe(1);
  });

  it("preserves conditional dependencies inside the tracked read callback", () => {
    const source = [
      signalDecl,
      "function App() { const useA = signal(true); const a = signal(\"A\"); const b = signal(\"B\");",
      "return <span>{useA.value ? a.value : b.value}</span>; }"
    ].join("\n");
    const result = compile({ fileName, source });
    expect(result.diagnostics.filter(d => d.severity === "error")).toEqual([]);
    expect(result.js[0]?.code).toContain("__zBindText");
    expect(allText(execute(source, "App").root)).toBe("A");
  });

  it("preserves svg namespaces and stable class style tokens", () => {
    const source = "function App() { return <svg viewBox=\"0 0 2 2\" class=\"p-2 text-sm\"><path d=\"M0 0\" /></svg>; }";
    const result = compile({ fileName, source });
    expect(result.diagnostics.filter(d => d.severity === "error")).toEqual([]);
    expect(result.js[0]?.code).toContain('__zCreateElement("path", "svg")');
    expect(result.manifest?.styleTokens).toEqual(["p-2", "text-sm"]);
  });

  it("emits valid original-source source maps with line mappings", () => {
    const result = compile({ fileName, source: counterSource });
    const map = JSON.parse(result.js[0]?.map ?? "{}") as {
      version: number; sources: string[]; mappings: string; sourcesContent?: string[];
    };
    expect(map.version).toBe(3);
    expect(map.sources.some(s => s.endsWith("fixture.tsx"))).toBe(true);
    expect(map.mappings.length).toBeGreaterThan(0);
    expect(map.sourcesContent?.some(s => s.includes("function Counter"))).toBe(true);
  });

  it("issues source-positioned diagnostics for unsupported JSX and dangerous sinks", () => {
    const source = "function App() { const props = { id: 'x' }; return <div {...props} />; }";
    const result = compile({ fileName, source });
    expect(result.js).toHaveLength(0);
    const error = result.diagnostics.find(d => d.code === "ZC1002");
    expect(error?.span?.start.line).toBe(1);
    expect(error?.span?.start.column).toBeGreaterThan(1);
    const unsafe = compile({ fileName,
      source: "function App() { return <div dangerouslySetInnerHTML={{__html: '<img>'}} />; }" });
    expect(unsafe.diagnostics.some(d => d.code === "ZC1003")).toBe(true);
    const scriptHref = compile({ fileName,
      source: 'function App() { return <div href="javascript:alert(1)" />; }' });
    expect(scriptHref.js).toHaveLength(0);
    expect(scriptHref.diagnostics.some(d => d.code === "ZC1005")).toBe(true);
    const variableHref = compile({ fileName,
      source: 'function App() { const href = "/safe"; return <div href={href} />; }' });
    expect(variableHref.diagnostics.some(d => d.code === "ZC1005")).toBe(true);
    const inlineHandler = compile({ fileName,
      source: 'function App() { return <div onload="alert(1)" />; }' });
    expect(inlineHandler.diagnostics.some(d => d.code === "ZC1006")).toBe(true);
  });

  it("rejects unsafe unknown reactive calls and TypeScript type errors", () => {
    const reactive = compile({ fileName, source: [
      signalDecl,
      "declare function format(value: number): string;",
      "function App() {const count = signal(1); return <span>{format(count.value)}</span>; }"
    ].join("\n") });
    expect(reactive.diagnostics.some(d => d.code === "ZC2106")).toBe(true);
    const typed = compile({ fileName,
      source: 'function App() { const value: number = "invalid"; return <div>{value}</div>; }' });
    expect(typed.diagnostics.some(d => d.code === "ZCTS2322")).toBe(true);
  });

  it("validates versioned IR and returns deterministic output hashes", () => {
    const request = { fileName, source: counterSource };
    const began = performance.now();
    const first = compile(request);
    const elapsedMs = performance.now() - began;
    const second = compile(request);
    const hash = (code: string) => createHash("sha256").update(code).digest("hex");
    console.info("COMPILER_BASELINE", JSON.stringify({
      fixture: "Counter", jsBytes: Buffer.byteLength(first.js[0]?.code ?? "", "utf8"),
      gzipBytes: gzipSync(first.js[0]?.code ?? "").byteLength,
      compileMs: Number(elapsedMs.toFixed(2))
    }));
    expect(first).toEqual(second);
    expect(hash(first.js[0]?.code ?? "")).toBe(hash(second.js[0]?.code ?? ""));
    expect(validateIR({ irVersion: 2, sourceFile: fileName, nodes: [] })[0]?.code).toBe("ZC3002");
    expect(parseToIR(request).document.irVersion).toBe(1);
  });
});
