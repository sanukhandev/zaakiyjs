/**
 * H4 opt-in, compiler-backed SSR for statically analyzable interactive regions.
 * The generated module interprets a finite, validated data blueprint; never
 * evaluates TSX, user expressions or unsafe HTML at request time.
 */
import { createHash } from "node:crypto";
import type { CompileRequest, CompilerDiagnostic, GeneratedAsset, IRNode, SourceSpan } from "./index.js";
import { compile, optimizeIR, parseToIR } from "./index.js";
import { renderLiteralAttribute, SSR_STATIC_TAGS, SSR_VOID_TAGS } from "./server-static.js";

type RegionNode =
  | { readonly kind: "element"; readonly id: string; readonly tag: string; readonly attrs: readonly string[]; readonly children: readonly RegionNode[] }
  | { readonly kind: "literal"; readonly value: string }
  | { readonly kind: "data"; readonly id: string; readonly path: readonly string[]; readonly source: "props" | "item" }
  | { readonly kind: "conditional"; readonly id: string; readonly path: readonly string[]; readonly yes: readonly RegionNode[]; readonly no: readonly RegionNode[] }
  | { readonly kind: "keyed"; readonly id: string; readonly path: readonly string[]; readonly itemName: string; readonly key: string; readonly rows: readonly RegionNode[] };
export interface RegionHydrationPlanV2 {
  readonly schema: "zaakiy.region-hydration/2";
  readonly routeId: string;
  readonly markerId: string;
  readonly templateDigest: string;
  readonly nodes: readonly RegionNode[];
}
export interface RegionServerRequest extends CompileRequest { readonly routeId: string }
export interface RegionServerCompileResult {
  readonly diagnostics: readonly CompilerDiagnostic[];
  readonly js: readonly GeneratedAsset[];
  readonly hydrationPlan?: RegionHydrationPlanV2;
}
const hash = (value: string): string => createHash("sha256").update(value).digest("hex");
const ROUTE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,199}$/;
const NAME = /^[A-Za-z_$][\w$]*$/;
const FORBIDDEN = new Set(["__proto__", "constructor", "prototype"]);
const REPARENTED = new Set(["table","thead","tbody","tfoot","tr","td","th","select","option","optgroup","template"]);
const PATH = /^(?:[A-Za-z_$][\w$]*)(?:\.[A-Za-z_$][\w$]*){1,4}$/;

function pathOf(expression: string, base: string): string[] {
  const value = expression.trim();
  if (!PATH.test(value) || !value.startsWith(base + ".")) throw new TypeError("H4 only permits plain data paths");
  const parts = value.split(".").slice(1);
  if (parts.some(part => FORBIDDEN.has(part))) throw new TypeError("Forbidden hydration data path");
  return parts;
}
export function compileRegionServer(request: RegionServerRequest): RegionServerCompileResult {
  const base = compile(request);
  const reject = (message: string, span?: SourceSpan): RegionServerCompileResult => ({
    js: [], diagnostics: [...base.diagnostics, {
      code: "ZSSR4001", severity: "error" as const, message, ...(span ? {span} : {})
    }]
  });
  if (base.diagnostics.some(item => item.severity === "error"))
    return { js: [], diagnostics: base.diagnostics };
  if (!ROUTE.test(request.routeId) || request.source.length > 262144)
    return reject("H4 requires a bounded source and safe route identity");
  const ir = optimizeIR(parseToIR(request).document);
  if (ir.nodes.length !== 1 || ir.nodes[0]?.kind !== "StaticElement")
    return reject("H4 requires a single native HTML root");
  let ordinal = 0;
  let count = 0;
  const nestedRegion = (nodes:readonly RegionNode[]):boolean => nodes.some(node =>
    node.kind === "conditional" || node.kind === "keyed" ||
    (node.kind === "element" && nestedRegion(node.children)));
  const convert = (nodes: readonly IRNode[], itemName?: string, depth = 0): RegionNode[] => {
    if (depth > 64) throw new RangeError("Hydration blueprint nesting limit exceeded");
    const output: RegionNode[] = [];
    for (const node of nodes) {
      if (++count > 4096) throw new RangeError("Hydration blueprint node budget exceeded");
      switch (node.kind) {
        case "StyleToken": case "PropertyBinding": break;
        case "StaticText": output.push({ kind: "literal", value: node.text }); break;
        case "DynamicText": {
          if (node.expression.reactive) throw new TypeError("H4 server data cannot read runtime signals");
          const value = node.expression.source.trim();
          const source = itemName && value.startsWith(itemName + ".") ? "item" : "props";
          output.push({ kind: "data", id: hash("zaakiy-region-data:" + request.routeId + ":" + ordinal++).slice(0, 32), source, path: pathOf(value, source === "item" ? itemName! : "props") });
          break;
        }
        case "StaticElement": {
          if (node.namespace !== "html" || !SSR_STATIC_TAGS.has(node.tag) || REPARENTED.has(node.tag))
            throw new TypeError("H4 disallows parser-normalized or unknown HTML tags");
          const attrs: string[] = [];
          for (const child of node.children) {
            if (child.kind === "PropertyBinding") {
              const rendered = renderLiteralAttribute(child);
              if (rendered) attrs.push(rendered);
            }
          }
          const children = convert(node.children.filter(child => child.kind !== "PropertyBinding"), itemName, depth + 1);
          if (SSR_VOID_TAGS.has(node.tag) && children.length)
            throw new TypeError("Void elements cannot contain hydration children");
          output.push({ kind: "element", id: hash("zaakiy-region-element:" + request.routeId + ":" + ordinal++).slice(0, 32), tag: node.tag, attrs, children });
          break;
        }
        case "ConditionalBlock": {
          if (node.condition.reactive) throw new TypeError("H4 conditional cannot execute server signals");
          const id = hash("zaakiy-region:" + request.routeId + ":" + ordinal++).slice(0, 32);
          const yes = convert(node.whenTrue, itemName, depth + 1);
          const no = convert(node.whenFalse, itemName, depth + 1);
          if (nestedRegion(yes) || nestedRegion(no))
            throw new TypeError("Nested dynamic regions inside a conditional need a later H4 ABI");
          output.push({ kind: "conditional", id, path: pathOf(node.condition.source, "props"),
            yes, no });
          break;
        }
        case "KeyedLoop": {
          if (itemName || !node.itemParameter || !NAME.test(node.itemParameter) ||
              node.collection.reactive || node.key.reactive)
            throw new TypeError("H4 requires direct keyed item binding without nested keyed scopes");
          const key = pathOf(node.key.source, node.itemParameter);
          if (key.length !== 1) throw new TypeError("H4 key must be one own item property");
          const id = hash("zaakiy-region:" + request.routeId + ":" + ordinal++).slice(0, 32);
          const rows = convert(node.body, node.itemParameter, depth + 1);
          if (rows.length !== 1 || rows[0]?.kind !== "element" || nestedRegion(rows))
            throw new TypeError("H4 keyed row must have one native element and no nested regions");
          output.push({ kind: "keyed", id, path: pathOf(node.collection.source, "props"),
            itemName: node.itemParameter, key: key[0]!, rows });
          break;
        }
        default: throw new TypeError("H4 rejects component calls, slots, executable events and unsupported IR");
      }
    }
    return output;
  };
  try {
    const nodes = convert(ir.nodes);
    const templateDigest = hash(JSON.stringify(nodes));
    const markerId = hash("zaakiy-region-root:" + request.routeId + ":" + templateDigest).slice(0, 32);
    const hydrationPlan: RegionHydrationPlanV2 = {
      schema: "zaakiy.region-hydration/2", routeId: request.routeId, markerId, templateDigest, nodes
    };
    // Only compiler-validated data literals are embedded. The code has no
    // TSX evaluator, dynamic import, arbitrary JavaScript or client dependency.
    const code = [
      'export const protocol = "zaakiy.render/1";',
      "export const hydrationPlan = " + JSON.stringify(hydrationPlan) + ";",
      "const escape = value => String(value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\"/g,'&quot;').replace(/'/g,'&#39;');",
      "const own = (object, path) => { let value = object; for (const key of path) {",
      " if (!value || typeof value !== 'object' || Array.isArray(value)) return null;",
      " const proto = Object.getPrototypeOf(value); if (proto !== Object.prototype && proto !== null) throw new TypeError('H4 plain data required');",
      " const prop = Object.getOwnPropertyDescriptor(value,key); if (!prop) return null;",
      " if (!Object.hasOwn(prop,'value')) throw new TypeError('H4 getter forbidden'); value = prop.value; } return value; };",
      "const text = value => { if (value == null || typeof value === 'boolean') return '';",
      " if (!['string','number','bigint'].includes(typeof value)) throw new TypeError('H4 scalar expected');",
      " const s = String(value); if (s.length > 65536) throw new RangeError('H4 scalar too long'); return escape(s); };",

      "const draw = (nodes, props, item, budget, depth = 0) => {",
      " if (depth > 64) throw new RangeError('H4 nesting bound'); let result = '';",
      " for (const node of nodes) { if (++budget.count > 8192) throw new RangeError('H4 output node bound');",
      " if (node.kind === 'literal') result += escape(node.value);",
      " else if (node.kind === 'data') result += '<!--zaakiy-d2:' + node.id + ':start-->' + text(own(node.source === 'item' ? item : props, node.path)) + '<!--zaakiy-d2:' + node.id + ':end-->';",
      " else if (node.kind === 'element') { result += '<' + node.tag + node.attrs.join('') + '>';",
      " if (node.children.length) result += draw(node.children,props,item,budget,depth+1);",
      " if (!" + JSON.stringify([...SSR_VOID_TAGS]) + ".includes(node.tag)) result += '</' + node.tag + '>'; }",
      " else if (node.kind === 'conditional') { result += '<!--zaakiy-r2:' + node.id + ':start-->';",
      " result += draw(own(props,node.path) ? node.yes : node.no,props,item,budget,depth+1);",
      " result += '<!--zaakiy-r2:' + node.id + ':end-->'; }",
      " else if (node.kind === 'keyed') { const rows = own(props,node.path);",
      " if (!Array.isArray(rows) || rows.length > 4096) throw new TypeError('H4 keyed data must be bounded array');",
      " const keys = new Set(); result += '<!--zaakiy-r2:' + node.id + ':start-->';",
      " for (const row of rows) { const key = own(row,[node.key]);",
      " if (typeof key !== 'string' && typeof key !== 'number') throw new TypeError('H4 key type');",
      " const name = String(key); if (!/^[A-Za-z0-9_.:]{1,64}$/.test(name) || keys.has(name)) throw new TypeError('H4 duplicate/unsafe key');",
      " keys.add(name); result += '<!--zaakiy-k2:' + node.id + ':' + name + ':start-->';",
      " result += draw(node.rows, props, row, budget, depth+1);",
      " result += '<!--zaakiy-k2:' + node.id + ':' + name + ':end-->'; }",
      " result += '<!--zaakiy-r2:' + node.id + ':end-->'; }",
      " } return result; };",
      "export function render(context) {",
      " if (!context || context.schema !== 'zaakiy.render/1' || context.route?.id !== " + JSON.stringify(request.routeId) + ") throw new TypeError('H4 invalid route');",
      " if (context.request?.signal?.aborted) throw context.request.signal.reason;",

      " const body = '<!--zaakiy-h:' + hydrationPlan.markerId + ':' + hydrationPlan.templateDigest + '-->' + draw(hydrationPlan.nodes,context.loaderData,null,{count:0});",
      " if (body.length > 1048576) throw new RangeError('H4 output too large');",
      " return {version:1,status:200,headers:{'content-type':'text/html; charset=utf-8'},body,cache:{scope:'no-store',tags:[]}};",
      "}"
    ].join("\n") + "\n";
    return { diagnostics: base.diagnostics, hydrationPlan,
      js: [{ fileName: request.fileName.replace(/\.[cm]?tsx?$/i, "") + ".region.server.js", code }] };
  } catch (error) {
    return reject(error instanceof Error ? error.message : "Unsafe H4 region source", ir.nodes[0]?.span);
  }
}
