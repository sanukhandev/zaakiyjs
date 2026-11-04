import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { compile, optimizeIR, parseToIR, validateIR } from "../src/index.js";

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

function execute(source: string, entry: string, globals: Record<string, unknown> = {}): { root: FakeNode; elements: FakeElement[]; writes: { text: number; evaluations: number } } {
  const compiled = compile({ fileName, source });
  expect(compiled.diagnostics.filter(d => d.severity === "error")).toEqual([]);
  const asset = compiled.js[0];
  expect(asset).toBeDefined();
  if (!asset) throw new Error("Compilation did not emit JS");
  const elements: FakeElement[] = [];
  const writes = { text: 0, evaluations: 0 };
  type TrackedRun = (() => void) & { readonly dependencies: Set<Set<TrackedRun>> };
  let active: TrackedRun | null = null;
  const signal = <T,>(initial: T) => {
    let value = initial;
    const observers = new Set<TrackedRun>();
    return Object.defineProperty({}, "value", {
      get() {
        if (active) {
          observers.add(active);
          active.dependencies.add(observers);
        }
        return value;
      },
      set(next: T) {
        if (Object.is(value, next)) return;
        value = next;
        for (const run of [...observers]) run();
      },
      enumerable: true
    });
  };
  const bind = (apply: () => void) => {
    const run = Object.assign(() => {
      for (const observers of run.dependencies) observers.delete(run);
      run.dependencies.clear();
      const previous = active;
      active = run;
      try { apply(); }
      finally { active = previous; }
    }, { dependencies: new Set<Set<TrackedRun>>() });
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
      bind(() => {
        writes.evaluations++;
        const value = read();
        const next = value == null || typeof value === "boolean" ? "" : String(value);
        if (node.data !== next) { node.data = next; writes.text++; }
      });
    },
    __zBindProperty(_owner: unknown, node: FakeElement, name: string, read: () => unknown) {
      bind(() => { node.properties[name] = read(); });
    },
    __zListen(_owner: unknown, node: FakeElement, name: string, fn: (event: unknown) => void) {
      node.listeners[name] = fn;
    },
    __zGetOwner() { return {}; },
    __zCreateOwner(parent: unknown) { return { parent }; },
    __zInitializeOwnedComponent(_owner: unknown, create: () => FakeNode) { return create(); },
  };
  const noImports = asset.code.split("\n")
    .filter(line => !line.trimStart().startsWith("import "))
    .join("\n").replace(/^export\s+/gm, "");
  const aliases: Record<string, unknown> = {};
  for (const match of asset.code.matchAll(/\b(\w+)\s+as\s+(__z\w+)/g)) {
    const original = match[1];
    const alias = match[2];
    if (!original || !alias) continue;
    const stubName = "__z" + original[0]!.toUpperCase() + original.slice(1);
    if (stubName in env) aliases[alias] = env[stubName as keyof typeof env];
  }
  const context = { ...env, ...aliases, ...globals, __fixture: undefined as (() => FakeNode) | undefined };
  runInNewContext(noImports + "\n__fixture = " + entry + ";", context, { timeout: 1000 });
  if (!context.__fixture) throw new Error("Missing fixture export: " + entry);
  return { root: context.__fixture(), elements, writes };
}

function allText(node: FakeNode): string {
  return "kind" in node ? node.data : node.children.map(allText).join("");
}

describe("TSX-to-DOM compiler safe vertical slice", () => {
  it("does not capture user variables with generated local DOM or owner names", () => {
    const source = 'function App(){const __z_owner_0="outer"; const __z_text_2="text";' +
      'return <span>{__z_owner_0 + __z_text_2}</span>;}';
    const result = compile({ fileName, source });
    expect(result.diagnostics.filter(d => d.severity === "error")).toEqual([]);
    expect(allText(execute(source, "App").root)).toBe("outertext");
  });

  it("avoids collisions between user identifiers and injected ESM helper imports", () => {
    const source = 'function App(){const __zCreateText="own";return <span>{__zCreateText}</span>;}';
    const result = compile({ fileName, source });
    expect(result.diagnostics.filter(d => d.severity === "error")).toEqual([]);
    expect(result.js[0]?.code).toContain("createText as __zCreateText_");
    expect(result.js[0]?.code).not.toMatch(/createText as __zCreateText[,}]/);
    expect(allText(execute(source, "App").root)).toBe("own");
  });

  it("uses hygienic helper aliases for reactive text even with user-level shadowing", () => {
    const source = [
      signalDecl,
      'function App(){const __zCreateText = "shadow"; const count = signal(1);',
      'return <span>{count.value}</span>;}'
    ].join("\n");
    const result = compile({ fileName, source });
    expect(result.diagnostics.filter(d => d.severity === "error")).toEqual([]);
    expect(result.js[0]?.code).toMatch(/createText as __zCreateText_\d+/);
    expect(allText(execute(source, "App").root)).toBe("1");
  });

  it("keeps user side-effect import order ahead of compiler runtime helpers", () => {
    const source = 'import "./setup.js"; function App(){return <main>ready</main>;}';
    const result = compile({ fileName, source });
    expect(result.diagnostics.filter(d => d.severity === "error")).toEqual([]);
    const code = result.js[0]?.code ?? "";
    expect(code.indexOf('import "./setup.js"')).toBeLessThan(code.indexOf("@zaakiyjs/dom/compiler"));
  });

  it("does not import DOM/core runtime helpers for a TSX module without any JSX", () => {
    const result = compile({ fileName, source: "export const answer: number = 42;" });
    expect(result.diagnostics.filter(d => d.severity === "error")).toEqual([]);
    expect(result.js).toHaveLength(1);
    expect(result.js[0]?.code).not.toContain("@zaakiyjs/dom/compiler");
    expect(result.js[0]?.code).not.toContain("@zaakiyjs/core");
  });

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
    expect(result.js[0]?.code).toContain("__zInitializeOwnedComponent");
    expect(result.js[0]?.code).toContain("initializeOwnedComponent as");
  });

  it("lowers static and reactive conditionals through the versioned region ABI", () => {
    const yes = compile({ fileName, source: "function App() { return <main>{true ? <span>yes</span> : <span>no</span>}</main>; }" });
    expect(yes.diagnostics.filter(d => d.severity === "error")).toEqual([]);
    expect(allText(execute("function App() { return <main>{true ? <span>yes</span> : <span>no</span>}</main>; }", "App").root)).toBe("yes");
    const dynamic = compile({ fileName, source: [
      signalDecl,
      "function App() {const flag = signal(true); return <main>{flag.value ? <span>yes</span> : <span>no</span>}</main>; }"
    ].join("\n") });
    expect(dynamic.diagnostics.filter(d => d.severity === "error")).toEqual([]);
    expect(dynamic.js).toHaveLength(1);
    expect(dynamic.js[0]?.code).toContain("bindConditionalRegion as");
    expect(dynamic.js[0]?.code).toContain("createRegion as");
  });

  it("prunes unreachable literal branches in optimized IR without changing their source identity", () => {
    const src = "function App(){ return <main>{false ? <span>dead</span> : <span>live</span>}</main>; }";
    const raw = parseToIR({ fileName, source: src }).document;
    const ir = optimizeIR(raw);
    const before = raw.nodes[0];
    const after = ir.nodes[0];
    expect(after?.id).toBe(before?.id);
    expect(after?.kind).toBe("StaticElement");
    if (after?.kind === "StaticElement") {
      const conditional = after.children.find(n => n.kind === "ConditionalBlock");
      expect(conditional?.kind).toBe("ConditionalBlock");
      if (conditional?.kind === "ConditionalBlock") {
        expect(conditional.whenTrue).toHaveLength(0);
        expect(conditional.whenFalse).toHaveLength(1);
      }
    }
  });

  it("rejects undeclared browser target profiles rather than promising unverified transforms", () => {
    const result = compile({ fileName, source: "function App(){return <div>ok</div>;}",
      targetBrowsers: ["chrome 90"] });
    expect(result.js).toEqual([]);
    expect(result.diagnostics.some(d => d.code === "ZC2301")).toBe(true);
  });

  it("compiles keyed maps using stable owner-scoped item signals", () => {
    const source = [
      "const items = [{ id: 1, label: 'first' }];",
      "function App() { return <main>{items.map(item => <span key={item.id}>{item.label}</span>)}</main>; }"
    ].join("\n");
    const parsed = parseToIR({ fileName, source });
    const root = parsed.document.nodes[0];
    expect(root?.kind).toBe("StaticElement");
    if (root?.kind !== "StaticElement") return;
    const loop = root.children.find(node => node.kind === "KeyedLoop");
    expect(loop?.kind).toBe("KeyedLoop");
    if (loop?.kind === "KeyedLoop") {
      expect(loop.itemParameter).toBe("item");
      expect(loop.collection.source).toBe("items");
    }
    const result = compile({ fileName, source });
    expect(result.diagnostics.filter(d => d.severity === "error")).toEqual([]);
    expect(result.js).toHaveLength(1);
    const js = result.js[0]?.code ?? "";
    expect(js).toContain("bindKeyedRegion as");
    expect(js).toContain('from "@zaakiyjs/signals"');
    expect(js).toContain(".value.label");
    expect(js).toContain("update:");
    expect(js).not.toContain('key=",');
  });

  it("rejects unsupported map item shapes and preserves explicit diagnostics", () => {
    const missingKey = compile({ fileName, source:
      "const items = [{ id: 1 }]; function App(){ return <main>{items.map(item => <span>{item.id}</span>)}</main>; }" });
    expect(missingKey.js).toEqual([]);
    expect(missingKey.diagnostics.some(d => d.code === "ZC2103")).toBe(true);
    const destructured = compile({ fileName, source:
      "const items = [{ id: 1 }]; function App(){ return <main>{items.map(({ id }) => <span key={id}>{id}</span>)}</main>; }" });
    expect(destructured.js).toEqual([]);
    expect(destructured.diagnostics.some(d => d.code === "ZC2103")).toBe(true);
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

  it("switches dynamic signal dependencies without rerunning for the inactive branch", () => {
    const source = [
      signalDecl,
      'function App() { const useA = signal(true); const a = signal("A"); const b = signal("B");',
      'return <main><span>{useA.value ? a.value : b.value}</span>',
      '<button onClick={() => useA.value = !useA.value}>toggle</button>',
      '<button onClick={() => a.value += "x"}>a</button>',
      '<button onClick={() => b.value += "y"}>b</button></main>; }'
    ].join("\n");
    const result = compile({ fileName, source });
    expect(result.diagnostics.filter(d => d.severity === "error")).toEqual([]);
    expect(result.js[0]?.code).toContain("__zBindText");
    const { elements, writes } = execute(source, "App");
    const label = elements.find(e => e.tag === "span");
    const buttons = elements.filter(e => e.tag === "button");
    expect(label && allText(label)).toBe("A");
    const originalNode = label?.children[0];
    buttons[0]?.listeners.click?.({});
    expect(label && allText(label)).toBe("B");
    expect(label?.children[0]).toBe(originalNode);
    const evaluations = writes.evaluations;
    const mutations = writes.text;
    buttons[1]?.listeners.click?.({});
    expect(writes.evaluations).toBe(evaluations);
    expect(writes.text).toBe(mutations);
    buttons[2]?.listeners.click?.({});
    expect(label && allText(label)).toBe("By");
    expect(writes.text).toBe(mutations + 1);
  });

  it("preserves svg namespaces and stable class style tokens", () => {
    const source = "function App() { return <svg viewBox=\"0 0 2 2\" class=\"p-2 text-sm\"><path d=\"M0 0\" /></svg>; }";
    const result = compile({ fileName, source });
    expect(result.diagnostics.filter(d => d.severity === "error")).toEqual([]);
    expect(result.js[0]?.code).toContain('__zCreateElement("path", "svg")');
    expect(result.manifest?.styleTokens).toEqual(["p-2", "text-sm"]);
  });

/** Decode only the original-line field needed to assert binding source provenance. */
function originalLineAt(map: { mappings: string }, generatedLine: number, generatedColumn: number): number | undefined {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let previousSource = 0;
  let previousLine = 0;
  const rows = map.mappings.split(";");
  for (let row = 0; row < rows.length; row++) {
    let column = 0;
    let match: number | undefined;
    for (const segment of (rows[row] ?? "").split(",").filter(Boolean)) {
      const values: number[] = [];
      let acc = 0;
      let shift = 0;
      for (const char of segment) {
        const digit = alphabet.indexOf(char);
        if (digit < 0) throw new Error("Invalid base64-VLQ mapping");
        acc += (digit & 31) * (2 ** shift);
        if (digit & 32) { shift += 5; continue; }
        values.push(acc & 1 ? -(acc >> 1) : (acc >> 1));
        acc = 0;
        shift = 0;
      }
      column += values[0] ?? 0;
      if (values.length >= 4) {
        previousSource += values[1] ?? 0;
        previousLine += values[2] ?? 0;
        if (row === generatedLine && column <= generatedColumn && previousSource === 0) {
          match = previousLine + 1;
        }
      }
    }
    if (row === generatedLine) return match;
  }
  return undefined;
}

  it("emits valid original-source source maps with line mappings", () => {
    const result = compile({ fileName, source: counterSource });
    const map = JSON.parse(result.js[0]?.map ?? "{}") as {
      version: number; sources: string[]; mappings: string; sourcesContent?: string[];
    };
    expect(map.version).toBe(3);
    expect(map.sources.some(s => s.endsWith("fixture.tsx"))).toBe(true);
    expect(map.mappings.length).toBeGreaterThan(0);
    expect(map.sourcesContent?.some(s => s.includes("function Counter"))).toBe(true);
    const emitted = result.js[0]?.code ?? "";
    const generatedRows = emitted.split("\n");
    const bindRow = generatedRows.findIndex(line => line.includes("__zBindText("));
    expect(bindRow).toBeGreaterThan(0);
    expect(originalLineAt(map, bindRow, generatedRows[bindRow]?.indexOf("__zBindText(") ?? 0)).toBe(4);
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



  it("extracts single-quoted static class tokens without throwing or reordering them", () => {
    const source = "function App(){ return <div class={'p-2 text-sm'}>safe</div>; }";
    const result = compile({ fileName, source });
    expect(result.diagnostics.filter(d => d.severity === "error")).toEqual([]);
    expect(result.manifest?.styleTokens).toEqual(["p-2", "text-sm"]);
    expect(result.js[0]?.code).toContain('p-2 text-sm');
  });

  it("rejects inline style attributes rather than emitting the DOM runtime's forbidden style sink", () => {
    const result = compile({ fileName, source:
      'function App(){ return <div style="color: red">unsafe</div>; }' });
    expect(result.js).toEqual([]);
    expect(result.diagnostics.some(d => d.code === "ZC2204")).toBe(true);
  });

  it("tracks aliased signal reads and nested signal props, without reinitializing components", () => {
    const aliases = [
      signalDecl,
      "function App() { const count = signal(1); const alias = count;",
      'return <main><span>{alias.value}</span><button onClick={() => count.value++}>+</button></main>; }'
    ].join("\n");
    const one = execute(aliases, "App");
    const span = one.elements.find(e => e.tag === "span");
    one.elements.find(e => e.tag === "button")?.listeners.click?.({});
    expect(span && allText(span)).toBe("2");
    const nested = [
      signalDecl,
      "function Label(props: { state: { value: number } }) { return <span>{props.state.value}</span>; }",
      "function App() { const state = signal(3);",
      'return <main><Label state={state} /><button onClick={() => state.value++}>+</button></main>; }'
    ].join("\n");
    const two = execute(nested, "App");
    const label = two.elements.find(e => e.tag === "span");
    two.elements.find(e => e.tag === "button")?.listeners.click?.({});
    expect(label && allText(label)).toBe("4");
    expect(two.elements.filter(e => e.tag === "span")).toHaveLength(1);
  });

  it("rejects nonprimitive dynamic children instead of silently coercing views or arrays to text", () => {
    const view = compile({ fileName, source:
      "function App(){ const nested = <span>hi</span>; return <main>{nested}</main>; }" });
    expect(view.js).toHaveLength(0);
    expect(view.diagnostics.some(d => d.code === "ZC2110")).toBe(true);
    const array = compile({ fileName, source:
      "function App(){ const items = [1, 2]; return <main>{items}</main>; }" });
    expect(array.js).toHaveLength(0);
    expect(array.diagnostics.some(d => d.code === "ZC2110")).toBe(true);
  });

  it("fails closed on JSX embedded in an unsupported expression", () => {
    const source = "function App() { return <main>{[<span>one</span>, <span>two</span>]}</main>; }";
    const result = compile({ fileName, source });
    expect(result.js).toEqual([]);
    expect(result.diagnostics.some(d => d.code === "ZC2108")).toBe(true);
  });

  it("validates deeply malformed IR with actionable diagnostics", () => {
    const base = parseToIR({ fileName, source: "function App(){return <main>x</main>;}" }).document;
    const broken = JSON.parse(JSON.stringify(base)) as {
      irVersion: number; nodes: Array<{ span?: unknown; children?: Array<{ expression?: unknown }> }>;
    };
    broken.nodes[0]!.span = { start: { line: -1, column: 0, offset: -4 } };
    expect(validateIR(broken).some(d => d.code === "ZC3004")).toBe(true);
    const badChild = JSON.parse(JSON.stringify(base)) as typeof broken;
    badChild.nodes[0]!.children![0]!.expression = { source: 10, reactive: "yes" };
    expect(validateIR(badChild).some(d => d.code === "ZC3004")).toBe(true);
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

describe("typed Show/For compiler intrinsics", () => {
  const prelude = [
    'import { Show, For } from "@zaakiyjs/core";',
    'import { signal } from "@zaakiyjs/signals";',
  ].join("\n");

  it("lowers typed Show fallback and keyed For to the frozen region ABI", () => {
    const source = [
      prelude,
      'const visible = signal(true);',
      'const items = signal([{id: 1, label: "one"}]);',
      'function App(){return <main><Show when={visible.value} fallback={<p>hidden</p>}><p>shown</p></Show>',
      '<ol><For each={items.value} by={row => row.id}>{row => <li>{row.label}</li>}</For></ol></main>;}'
    ].join("\n");
    const ir = parseToIR({ fileName, source });
    expect(ir.diagnostics.filter(d => d.severity === "error")).toEqual([]);
    expect(ir.document.nodes[0]?.kind).toBe("StaticElement");
    const result = compile({ fileName, source });
    expect(result.diagnostics.filter(d => d.severity === "error")).toEqual([]);
    expect(result.js).toHaveLength(1);
    const code = result.js[0]?.code ?? "";
    expect(code).toContain("bindConditionalRegion");
    expect(code).toContain("bindKeyedRegion");
    expect(code).toContain("update:");
    expect(code).not.toContain("react/jsx-runtime");
    const parsedRoot = ir.document.nodes[0];
    if (parsedRoot?.kind === "StaticElement") {
      const show = parsedRoot.children.find(node => node.kind === "ConditionalBlock");
      expect(show?.kind).toBe("ConditionalBlock");
      const list = parsedRoot.children.find(node => node.kind === "StaticElement" && node.tag === "ol");
      expect(list?.kind).toBe("StaticElement");
      if (list?.kind === "StaticElement") {
        const loop = list.children.find(node => node.kind === "KeyedLoop");
        expect(loop?.kind).toBe("KeyedLoop");
        if (loop?.kind === "KeyedLoop") {
          expect(loop.collection.source).toBe("items.value");
          expect(loop.itemParameter).toBe("row");
          expect(loop.key.source).toContain("row.id");
        }
      }
    }
  });

  it("recognizes alias imports without hijacking unrelated local components", () => {
    const source = [
      'import {Show as Visible, For as Each} from "@zaakiyjs/core";',
      'const list = [{id: 1}];',
      'function App(){return <main><Visible when={true}><p>Y</p></Visible>',
      '<Each each={list} by={x => x.id}>{row => <p>{row.id}</p>}</Each></main>;}'
    ].join("\n");
    const result = compile({ fileName, source });
    expect(result.diagnostics.filter(d => d.severity === "error")).toEqual([]);
    expect(result.js[0]?.code).toContain("bindKeyedRegion");
    const unrelated = compile({ fileName, source:
      'function Show(props: {children?: unknown}) {return <b>custom</b>}; function App(){return <main><Show /></main>}' });
    expect(unrelated.diagnostics.filter(d => d.severity === "error")).toEqual([]);
    expect(unrelated.js[0]?.code).not.toContain("bindConditionalRegion(");
  });

  it("fails closed for malformed control flow without emitting JS", () => {
    const bad = [
      prelude,
      'const items = [{id: 1}];',
      'function App(){return <main><Show when={true}><p>a</p><p>b</p></Show>',
      '<For each={items} by={row => row.id}>{row => <p>{row.id}</p>}</For>',
      '<For each={items} by={row => row.id}>{row => <p>{row.id}</p>}<p>extra</p></For>',
      '</main>;}'
    ].join("\n");
    const result = compile({fileName, source: bad});
    expect(result.js).toEqual([]);
    expect(result.diagnostics.some(d => d.code === "ZC2403")).toBe(true);
    expect(result.diagnostics.some(d => d.code === "ZC2404")).toBe(true);
    const noImport = compile({fileName, source:
      'function App() {return <main><Show when={true}><p>x</p></Show></main>}'});
    expect(noImport.js).toEqual([]);
  });

  it("keeps generated assets deterministic and rejects invalid key types", () => {
    const source = [
      prelude,
      'const rows = [{id: "a"}];',
      'function App(){return <ul><For each={rows} by={x => x.id}>{row => <li>{row.id}</li>}</For></ul>}'
    ].join("\n");
    const a = compile({fileName, source});
    const b = compile({fileName, source});
    expect(a.diagnostics.filter(d => d.severity === "error")).toEqual([]);
    expect(a.js[0]?.code).toBe(b.js[0]?.code);
    expect(a.js[0]?.map).toBe(b.js[0]?.map);
    const invalid = compile({fileName, source: [
      prelude, 'const rows = [{id: "a"}];',
      'function App(){return <ul><For each={rows} by={x => ({id:x.id})}>{row => <li>{row.id}</li>}</For></ul>}'
    ].join("\n")});
    expect(invalid.js).toEqual([]);
    expect(invalid.diagnostics.some(d => d.severity === "error")).toBe(true);
  });
});
