/**
 * Build-time, read-only data-bound server HTML output.
 * Source TSX is analyzed, never evaluated. Only paths like props.customer.name
 * are lowered into bounded property reads of context.loaderData. The generated
 * Node module has no JSX runtime, compiler dependency or global request state.
 *
 * This is NOT DOM hydration or general component SSR.
 */
import type { CompileRequest, CompilerDiagnostic, GeneratedAsset, IRNode, SourceSpan } from "./index.js";
import { compile, optimizeIR, parseToIR } from "./index.js";
import {
  escapeStaticHtml, renderLiteralAttribute, SSR_STATIC_TAGS, SSR_VOID_TAGS
} from "./server-static.js";

export interface DataServerRequest extends CompileRequest {
  readonly routeId: string;
  /** Opt-in async byte-streaming output. Does not enable DOM hydration. */
  readonly streaming?: boolean;
}
export interface DataServerCompileResult {
  readonly diagnostics: readonly CompilerDiagnostic[];
  readonly js: readonly GeneratedAsset[];
  readonly dynamicPaths: readonly (readonly string[])[];
}

const ROUTE_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,199}$/;
const PATH = /^props(?:\.[A-Za-z_$][\w$]*){1,4}$/;
const FORBIDDEN = new Set(["__proto__", "constructor", "prototype"]);
const MAX_NODES = 4096;
const MAX_SOURCE_SIZE = 256 * 1024;

/** Return only a syntactically simple path; never embed TSX expression source in emitted JS. */
function dataPath(node: Extract<IRNode, { kind: "DynamicText" }>): string[] {
  const source = node.expression.source.trim();
  if (node.expression.reactive || !PATH.test(source)) {
    throw new Error("Data SSR permits only nonreactive props.field paths (max depth 4)");
  }
  const pieces = source.split(".").slice(1);
  if (pieces.some(piece => FORBIDDEN.has(piece))) {
    throw new Error("Data SSR rejects prototype and constructor property paths");
  }
  return pieces;
}

/**
 * Compile a fixed structural HTML tree with read-only loaderData text slots.
 * The generated module reads plain own data properties, never calls a getter,
 * evaluates a TSX expression or accesses private context services.
 */
export function compileDataServer(request: DataServerRequest): DataServerCompileResult {
  const base = compile(request);
  const empty: DataServerCompileResult = { js: [], diagnostics: base.diagnostics, dynamicPaths: [] };
  if (base.diagnostics.some(item => item.severity === "error")) return empty;
  const reject = (message: string, span?: SourceSpan): DataServerCompileResult => ({
    js: [], dynamicPaths: [],
    diagnostics: [...base.diagnostics, { code: "ZSSR2001", severity: "error" as const, message,
      ...(span ? { span } : {}) }]
  });
  if (!ROUTE_ID.test(request.routeId) || request.source.length > MAX_SOURCE_SIZE) {
    return reject("Data SSR requires a safe route ID and bounded source length");
  }
  const parsed = parseToIR(request);
  const ir = optimizeIR(parsed.document);
  if (ir.nodes.length !== 1 || ir.nodes[0]?.kind !== "StaticElement") {
    return reject("Data SSR requires exactly one native HTML root");
  }

  const fragments: string[] = [];
  const dataPaths: string[][] = [];
  let count = 0;
  const emit = (node: IRNode, depth: number): void => {
    if (++count > MAX_NODES || depth > 64) {
      throw new Error("Data SSR markup exceeds its static node/depth budget");
    }
    switch (node.kind) {
      case "StaticText":
        fragments.push(JSON.stringify(escapeStaticHtml(node.text)));
        return;
      case "DynamicText": {
        const path = dataPath(node);
        dataPaths.push(path);
        fragments.push("__escape(__read(context.loaderData, " + JSON.stringify(path) + "))");
        return;
      }
      case "StyleToken":
        return;
      case "StaticElement": {
        if (node.namespace !== "html" || !SSR_STATIC_TAGS.has(node.tag)) {
          throw new Error("Data SSR requires allowlisted HTML tags");
        }
        let open = "<" + node.tag;
        const attributes = new Set<string>();
        const children: IRNode[] = [];
        for (const part of node.children) {
          if (part.kind === "PropertyBinding") {
            const name = part.name.toLowerCase();
            if (attributes.has(name)) throw new Error("Duplicate HTML attributes are forbidden");
            attributes.add(name);
            open += renderLiteralAttribute(part);
          } else if (part.kind !== "StyleToken") {
            if (part.kind === "EventBinding") {
              throw new Error("Unhydrated event handlers are forbidden in data SSR");
            }
            children.push(part);
          }
        }
        open += ">";
        fragments.push(JSON.stringify(open));
        if (SSR_VOID_TAGS.has(node.tag)) {
          if (children.length) throw new Error("Void HTML elements cannot have children");
          return;
        }
        for (const child of children) emit(child, depth + 1);
        fragments.push(JSON.stringify("</" + node.tag + ">"));
        return;
      }
      default:
        throw new Error("Data SSR does not support components, branches, loops or executable JSX");
    }
  };
  try { emit(ir.nodes[0], 0); }
  catch (error) {
    return reject(error instanceof Error ? error.message : "Unsupported data SSR markup",
      ir.nodes[0]?.span);
  }
  if (fragments.join(",").length > MAX_SOURCE_SIZE * 2) {
    return reject("Data SSR generated module exceeds size limit");
  }

  // All emitted instructions are fixed and reviewed. The only variable bytes
  // derived from TSX are quoted static HTML and a validated array of names.
  const js = [
    'export const protocol = "zaakiy.render/1";',
    'const __escape = value => {',
    '  if (value == null || typeof value === "boolean") return "";',
    '  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "bigint") throw new TypeError("SSR text must be primitive");',
    '  const text = String(value);',
    '  if (text.length > 65536) throw new RangeError("SSR data value exceeds text limit");',
    '  return text.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/\\x27/g,"&#39;");',
    '};',
    'const __read = (data, path) => {',
    '  let object = data;',
    '  for (const key of path) {',
    '    if (object === null || typeof object !== "object" || Array.isArray(object)) return null;',
    '    const proto = Object.getPrototypeOf(object);',
    '    if (proto !== Object.prototype && proto !== null) throw new TypeError("SSR data must be plain");',
    '    const descriptor = Object.getOwnPropertyDescriptor(object, key);',
    '    if (!descriptor) return null;',
    '    if (!Object.hasOwn(descriptor, "value")) throw new TypeError("SSR getters are forbidden");',
    '    object = descriptor.value;',
    '  }',
    '  return object;',
    '};',
    'export function render(context) {',
    '  if (!context || context.schema !== "zaakiy.render/1" || !context.request || !context.route) throw new TypeError("Invalid SSR context");',
    '  if (context.route.id !== ' + JSON.stringify(request.routeId) + ') throw new TypeError("SSR route mismatch");',
    '  if (context.request.signal.aborted) throw context.request.signal.reason;',
    ...(request.streaming === true ? [
      '  const body = (async function* () {',
      '    const encoder = new TextEncoder();',
      '    let pending = "";',
      '    let total = 0;',
      '    for (const piece of (function* () {',
      ...fragments.map(part => "      yield " + part + ";"),
      '    })()) {',
      '      if (context.request.signal.aborted) throw context.request.signal.reason;',
      '      total += piece.length;',
      '      if (total > 1048576) throw new RangeError("SSR response exceeded output limit");',
      '      pending += piece;',
      '      if (pending.length >= 16384) { yield encoder.encode(pending); pending = ""; }',
      '    }',
      '    if (context.request.signal.aborted) throw context.request.signal.reason;',
      '    if (pending) yield encoder.encode(pending);',
      '  })();'
    ] : [
      '  const body = [' + fragments.join(",") + '].join("");',
      '  if (body.length > 1048576) throw new RangeError("SSR response exceeded output limit");'
    ]),
    '  return { version: 1, status: 200, headers: { "content-type": "text/html; charset=utf-8" }, body,',
    '    cache: { scope: "no-store", tags: [] } };',
    '}'
  ].join("\n") + "\n";
  return {
    diagnostics: base.diagnostics,
    dynamicPaths: dataPaths,
    js: [{
      fileName: request.fileName.replace(/\.[cm]?tsx?$/i, "") + ".server.js",
      code: js
    }]
  };
}
