/**
 * H4 opt-in, compiler-backed SSR for statically analyzable interactive regions.
 * The generated module interprets a finite, validated data blueprint; never
 * evaluates TSX, user expressions or unsafe HTML at request time.
 */
import { createHash } from "node:crypto";
import * as ts from "typescript";
import type { CompileRequest, CompilerDiagnostic, GeneratedAsset, IRNode, SourceSpan } from "./index.js";
import { compile, optimizeIR, parseToIR } from "./index.js";
import { renderLiteralAttribute, SSR_STATIC_TAGS, SSR_VOID_TAGS } from "./server-static.js";

type RegionNode =
  | { readonly kind: "element"; readonly id: string; readonly tag: string; readonly attrs: readonly string[]; readonly events?: readonly {readonly name:string; readonly path:readonly string[]}[]; readonly children: readonly RegionNode[] }
  | { readonly kind: "component"; readonly id: string; readonly children: readonly RegionNode[] }
  | { readonly kind: "literal"; readonly value: string }
  | { readonly kind: "data"; readonly id: string; readonly path: readonly string[]; readonly source: "props" | "item" }
  | { readonly kind: "conditional"; readonly id: string; readonly path: readonly string[]; readonly source: "props" | "item"; readonly yes: readonly RegionNode[]; readonly no: readonly RegionNode[] }
  | { readonly kind: "keyed"; readonly id: string; readonly path: readonly string[]; readonly source: "props" | "item"; readonly itemName: string; readonly key: string; readonly rows: readonly RegionNode[] };
export interface RegionHydrationPlanV2 {
  readonly schema: "zaakiy.region-hydration/2";
  readonly routeId: string;
  readonly markerId: string;
  readonly templateDigest: string;
  readonly nodes: readonly RegionNode[];
  /** Optional explicit compiler-selected limits; standard plan omits this field. */
  readonly limits?: {readonly maxRows:10000;readonly maxNodes:50000;readonly maxHtmlBytes:8388608};
}
export interface RegionServerRequest extends CompileRequest {
  readonly routeId: string;
  /** Named local TSX entry; defaults to Page when multiple functions exist. */
  readonly entryComponent?: string;
  /** Explicit large-list tier; standard remains 4,096 rows and 8,192 nodes. */
  readonly hydrationScale?: "standard" | "large";
  /** Trusted build-time import sources; verified by SHA-256 and never executed. */
  readonly componentModules?: readonly {
    readonly specifier:string;readonly fileName:string;
    readonly source:string;readonly digest:string;
  }[];
}
export interface RegionServerCompileResult {
  readonly diagnostics: readonly CompilerDiagnostic[];
  readonly js: readonly GeneratedAsset[];
  readonly hydrationPlan?: RegionHydrationPlanV2;
  /** Trusted build-generated browser module; never included in SSR HTML. */
  readonly clientEvents?: readonly GeneratedAsset[];
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
  if(request.hydrationScale !== undefined && !["standard","large"].includes(request.hydrationScale))
    return reject("Unknown H4 hydration scale");
  const large=request.hydrationScale==="large";
  const limits=large?{maxRows:10000 as const,maxNodes:50000 as const,maxHtmlBytes:8388608 as const}:undefined;
  const ir = optimizeIR(parseToIR(request).document);
  const sourceFile = ts.createSourceFile(request.fileName,request.source,
    ts.ScriptTarget.ES2022,true,ts.ScriptKind.TSX);
  const functions = new Map<string,IRNode>();
  const unwrap = (expr:ts.Expression):ts.Expression =>
    ts.isParenthesizedExpression(expr) ? unwrap(expr.expression) : expr;
  for (const statement of sourceFile.statements) {
    if (!ts.isFunctionDeclaration(statement) || !statement.name ||
        !statement.body || statement.body.statements.length !== 1) continue;
    const only = statement.body.statements[0];
    if (!only || !ts.isReturnStatement(only)) continue;
    const returned = only.expression;
    if (!returned) continue;
    const jsx = unwrap(returned);
    if (!ts.isJsxElement(jsx) && !ts.isJsxSelfClosingElement(jsx)) continue;
    if (statement.asteriskToken ||
        statement.modifiers?.some(m => m.kind===ts.SyntaxKind.AsyncKeyword) ||
        statement.parameters.length > 1 ||
        (statement.parameters[0] && (!ts.isIdentifier(statement.parameters[0].name) ||
          statement.parameters[0].name.text !== "props" ||
          Boolean(statement.parameters[0].initializer) ||
          Boolean(statement.parameters[0].dotDotDotToken)))) {
      return reject("H4 component props must use one named props parameter");
    }
    const root = ir.nodes.find(node => node.span.start.offset === jsx.getStart(sourceFile));
    if (!root) return reject("H4 component JSX could not be matched to compiler IR");
    if (functions.has(statement.name.text)) return reject("Duplicate local H4 component");
    functions.set(statement.name.text,root);
  }
  if ((request.componentModules?.length??0)>32)
    return reject("H4 imported component source budget exceeded");
  const imports=new Map<string,{specifier:string;exportName:string}>();
  for(const statement of sourceFile.statements){
    if(!ts.isImportDeclaration(statement) ||
        !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const specifier=statement.moduleSpecifier.text;
    const bindings=statement.importClause?.namedBindings;
    if(!bindings || !ts.isNamedImports(bindings)) continue;
    for(const binding of bindings.elements){
      imports.set(binding.name.text,{
        specifier,exportName:binding.propertyName?.text??binding.name.text
      });
    }
  }
  const configured=new Set<string>();
  for(const module of request.componentModules??[]){
    if(!new RegExp("^\\./[A-Za-z0-9_./-]+\\.[cm]?jsx?$").test(module.specifier) ||
        module.specifier.includes("..") || module.fileName.startsWith("/") ||
        module.fileName.split("/").includes("..") ||
        !new RegExp("^[A-Za-z0-9_./-]+\\.[cm]?tsx?$").test(module.fileName) ||
        module.source.length>65536 || hash(module.source)!==module.digest ||
        configured.has(module.specifier)){
      return reject("H4 imported component requires unique pinned, relative source");
    }
    configured.add(module.specifier);
    const imported=[...imports.entries()].filter(([,ref])=>ref.specifier===module.specifier);
    if(!imported.length) return reject("H4 supplied source has no static named import");
    const moduleFile=ts.createSourceFile(module.fileName,module.source,
      ts.ScriptTarget.ES2022,true,ts.ScriptKind.TSX);
    if(moduleFile.statements.some(statement=>
      !ts.isFunctionDeclaration(statement) &&
      !ts.isInterfaceDeclaration(statement) &&
      !ts.isTypeAliasDeclaration(statement) &&
      !(ts.isImportDeclaration(statement) && statement.importClause?.isTypeOnly))){
      return reject("H4 imported modules must have no top-level executable declarations");
    }
    const diagnostics=compile({fileName:module.fileName,source:module.source});
    if(diagnostics.diagnostics.some(item=>item.severity==="error"))
      return reject("H4 imported component module has compiler/type errors");
    const moduleIR=optimizeIR(parseToIR({fileName:module.fileName,source:module.source}).document);
    for(const [localName,ref] of imported){
      if(functions.has(localName)) return reject("Duplicate H4 imported component alias");
      const statement=moduleFile.statements.find(value=>
        ts.isFunctionDeclaration(value) && value.name?.text===ref.exportName);
      if(!statement || !ts.isFunctionDeclaration(statement) ||
          !statement.modifiers?.some(value=>value.kind===ts.SyntaxKind.ExportKeyword) ||
          !statement.body || statement.body.statements.length!==1 ||
          !ts.isReturnStatement(statement.body.statements[0]!) ||
          statement.parameters.length>1 ||
          (statement.parameters[0] &&
            (!ts.isIdentifier(statement.parameters[0].name) ||
              statement.parameters[0].name.text!=="props"))) {
        return reject("Imported H4 component must export a pure single-return function");
      }
      const returned=statement.body.statements[0]!.expression;
      if(!returned) return reject("Imported H4 component has no JSX return");
      const jsx=unwrap(returned);
      if(!ts.isJsxElement(jsx) && !ts.isJsxSelfClosingElement(jsx))
        return reject("Imported H4 component must return native JSX");
      const root=moduleIR.nodes.find(node=>node.span.start.offset===jsx.getStart(moduleFile));
      if(!root || root.kind!=="StaticElement")
        return reject("Imported H4 component IR root missing");
      functions.set(localName,root);
    }
  }
  const entryName = request.entryComponent ?? "Page";
  const root = functions.get(entryName) ??
    (functions.size === 1 ? [...functions.values()][0] :
      (functions.size === 0 && ir.nodes.length === 1 ? ir.nodes[0] : undefined));
  if (!root || root.kind !== "StaticElement")
    return reject("H4 requires a named Page TSX root or a single native root");
  let ordinal = 0;
  let count = 0;
  type BoundValue = { readonly source: "props" | "item"; readonly path: readonly string[] };
  const resolve = (source: string,itemName?: string,
    aliases?: ReadonlyMap<string,BoundValue>): BoundValue => {
    const value = source.trim();
    if (itemName && value.startsWith(itemName + "."))
      return { source:"item",path:pathOf(value,itemName) };
    const path=pathOf(value,"props");
    if (!aliases) return { source:"props",path };
    const from=aliases.get(path[0]!);
    if (!from) throw new TypeError("Unbound component data prop: "+path[0]);
    const mapped=[...from.path,...path.slice(1)];
    if (mapped.length>4) throw new TypeError("H4 component prop path depth exceeded");
    return {source:from.source,path:mapped};
  };
  interface SlotInput {
    readonly nodes:readonly IRNode[];
    readonly itemName?:string;
    readonly aliases?:ReadonlyMap<string,BoundValue>;
    readonly stack:readonly string[];
  }
  const inlineHandlers: Array<{id:string; body:string}>=[];
  const handlerFor=(source:string,itemName?:string,
    aliases?:ReadonlyMap<string,BoundValue>):string=>{
    const parsed=ts.createSourceFile("zaakiy-event.tsx",
      "const __handler = "+source+";",ts.ScriptTarget.ES2022,true,ts.ScriptKind.TSX);
    if(((parsed as ts.SourceFile & {parseDiagnostics?:readonly ts.Diagnostic[]}).parseDiagnostics?.length??0)>0 || parsed.statements.length!==1)
      throw new TypeError("H4 inline JSX handler syntax unsupported");
    const stmt=parsed.statements[0];
    if(!stmt || !ts.isVariableStatement(stmt)) throw new TypeError("Invalid H4 handler AST");
    const expr=stmt.declarationList.declarations[0]?.initializer;
    if(!expr || !ts.isArrowFunction(expr) || expr.modifiers?.length ||
        expr.parameters.length>1 || !ts.isCallExpression(expr.body) ||
        expr.body.questionDotToken || expr.body.typeArguments?.length)
      throw new TypeError("H4 only permits synchronous direct action-call arrow handlers");
    const parameter=expr.parameters[0]?.name;
    if(parameter && (!ts.isIdentifier(parameter) || Boolean(expr.parameters[0]?.initializer) ||
        Boolean(expr.parameters[0]?.dotDotDotToken)))
      throw new TypeError("Unsupported H4 event parameter");
    const paramName=parameter && ts.isIdentifier(parameter)?parameter.text:undefined;
    const dotted=(candidate:ts.Expression):string=>{
      if(ts.isIdentifier(candidate)) return candidate.text;
      if(ts.isPropertyAccessExpression(candidate) && !candidate.questionDotToken)
        return dotted(candidate.expression)+"."+candidate.name.text;
      throw new TypeError("Unsafe H4 handler reference");
    };
    const callPath=resolve(dotted(expr.body.expression),itemName,aliases);
    if(callPath.source!=="props") throw new TypeError("H4 actions must be root-props methods");
    const jsPath=(base:string,path:readonly string[]):string=>
      base+path.map(segment=>"["+JSON.stringify(segment)+"]").join("");
    const args=expr.body.arguments.map(argument=>{
      if(ts.isSpreadElement(argument)) throw new TypeError("H4 event spread calls forbidden");
      if(ts.isStringLiteral(argument)) return JSON.stringify(argument.text);
      if(ts.isNumericLiteral(argument)) {const numeric=Number(argument.text);if(!Number.isFinite(numeric)) throw new TypeError("Invalid numeric handler argument");return String(numeric);}
      if(argument.kind===ts.SyntaxKind.TrueKeyword) return "true";
      if(argument.kind===ts.SyntaxKind.FalseKeyword) return "false";
      if(argument.kind===ts.SyntaxKind.NullKeyword) return "null";
      if(ts.isIdentifier(argument) && paramName && argument.text===paramName) return "event";
      const bound=resolve(dotted(argument),itemName,aliases);
      return jsPath(bound.source==="item"?"getItem()":"props",bound.path);
    });
    return "(event)=>"+jsPath("props",callPath.path)+"("+args.join(",")+")";
  };
  const convert = (nodes: readonly IRNode[], itemName?: string, depth = 0,
    aliases?: ReadonlyMap<string,BoundValue>, stack: readonly string[] = [],
    slots?:ReadonlyMap<string,SlotInput>): RegionNode[] => {
    if (depth > 64) throw new RangeError("Hydration blueprint nesting limit exceeded");
    const output: RegionNode[] = [];
    for (const node of nodes) {
      if (++count > 4096) throw new RangeError("Hydration blueprint node budget exceeded");
      switch (node.kind) {
        case "StyleToken": case "PropertyBinding": break;
        case "StaticText": output.push({ kind: "literal", value: node.text }); break;
        case "DynamicText": {
          if (node.expression.reactive) throw new TypeError("H4 server data cannot read runtime signals");
          const bound = resolve(node.expression.source,itemName,aliases);
          output.push({ kind: "data", id: hash("zaakiy-region-data:" + request.routeId + ":" + ordinal++).slice(0, 32), ...bound });
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
          const events: {name:string;path:string[]}[] = [];
          for (const child of node.children) {
            if (child.kind !== "EventBinding") continue;
            if(!/^[a-z][a-z0-9]*$/.test(child.name))
              throw new TypeError("Invalid typed JSX event name");
            if(events.some(event=>event.name===child.name))
              throw new TypeError("Duplicate H4 JSX event handler");
            if(child.expression.source.trim().includes("=>")){
              const handlerId="h"+hash("zaakiy-event:"+request.routeId+":"+(ordinal++)).slice(0,31);
              const body=handlerFor(child.expression.source,itemName,aliases);
              inlineHandlers.push({id:handlerId,body});
              events.push({name:child.name,path:["zaakiyEvent",handlerId]});
            } else {
              const bound=resolve(child.expression.source,itemName,aliases);
              if(bound.source!=="props")
                throw new TypeError("H4 handler reference must point to root props");
              events.push({name:child.name,path:[...bound.path]});
            }
          }
          const children = convert(node.children.filter(child => child.kind !== "PropertyBinding" &&
            child.kind !== "EventBinding"),
            itemName, depth + 1,aliases,stack,slots);
          if (SSR_VOID_TAGS.has(node.tag) && children.length)
            throw new TypeError("Void elements cannot contain hydration children");
          output.push({ kind: "element", id: hash("zaakiy-region-element:" + request.routeId + ":" + ordinal++).slice(0, 32), tag: node.tag, attrs, ...(events.length ? {events} : {}), children });
          break;
        }
        case "ConditionalBlock": {
          if (node.condition.reactive) throw new TypeError("H4 conditional cannot execute server signals");
          const id = hash("zaakiy-region:" + request.routeId + ":" + ordinal++).slice(0, 32);
          const yes = convert(node.whenTrue, itemName, depth + 1,aliases,stack,slots);
          const no = convert(node.whenFalse, itemName, depth + 1,aliases,stack);
          const condition=resolve(node.condition.source,itemName,aliases);
          output.push({ kind: "conditional", id, path: condition.path,source:condition.source,yes,no });
          break;
        }
        case "KeyedLoop": {
          if (!node.itemParameter || !NAME.test(node.itemParameter) ||
              node.collection.reactive || node.key.reactive)
            throw new TypeError("H4 requires direct keyed item binding without nested keyed scopes");
          const key = pathOf(node.key.source, node.itemParameter);
          if (key.length !== 1) throw new TypeError("H4 key must be one own item property");
          const id = hash("zaakiy-region:" + request.routeId + ":" + ordinal++).slice(0, 32);
          const rows = convert(node.body, node.itemParameter, depth + 1,aliases,stack);
          if (rows.length !== 1 || rows[0]?.kind !== "element")
            throw new TypeError("H4 keyed row must have exactly one native root");
          const collection=resolve(node.collection.source,itemName,aliases);
          output.push({ kind: "keyed", id, path: collection.path,source:collection.source,
            itemName: node.itemParameter, key: key[0]!, rows });
          break;
        }
        case "ComponentCall": {
          if (stack.includes(node.component) || stack.length>=16)
            throw new TypeError("Recursive H4 component composition is not supported");
          const template=functions.get(node.component);
          if (!template) throw new TypeError("H4 component must be a local pure TSX function");
          if ((node.children?.length || node.slots?.length) && !request.componentSlots)
            throw new TypeError("H4 slot call requires componentSlots: true");
          const passed=new Map<string,SlotInput>();
          if(node.children?.length)
            passed.set("children",{nodes:node.children,itemName,aliases,stack});
          for(const named of node.slots??[]){
            if(passed.has(named.name)) throw new TypeError("Duplicate component slot");
            passed.set(named.name,{nodes:named.children,itemName,aliases,stack});
          }
          const mapping=new Map<string,BoundValue>();
          for (const prop of node.props) {
            if (mapping.has(prop.name)) throw new TypeError("Duplicate H4 component prop");
            mapping.set(prop.name,resolve(prop.expression.source,itemName,aliases));
          }
          const id=hash("zaakiy-region-component:"+request.routeId+":"+ordinal++).slice(0,32);
          output.push({kind:"component",id,
            children:convert([template],itemName,depth+1,mapping,[...stack,node.component],passed)});
          break;
        }
        case "SlotOutlet": {
          if(!request.componentSlots) throw new TypeError("Slot outlets require componentSlots: true");
          const supplied=slots?.get(node.name);
          if(!supplied) throw new TypeError("Unresolved H4 slot outlet: "+node.name);
          output.push(...convert(supplied.nodes,supplied.itemName,depth+1,
            supplied.aliases,supplied.stack));
          break;
        }
        default: throw new TypeError("H4 rejects executable or unsupported IR");
      }
    }
    return output;
  };
  try {
    const nodes = convert([root],undefined,0,undefined,[entryName]);
    if(large){
      const seen=new Set<string>();
      const inspectMarkers=(items:readonly RegionNode[]):void=>{
        for(const node of items){
          if(node.kind==="data"){
            const marker=node.id.slice(0,16);
            if(seen.has(marker)) throw new TypeError("H4 compact data marker collision");
            seen.add(marker);
          }else if(node.kind==="element" || node.kind==="component"){
            inspectMarkers(node.children);
          }else if(node.kind==="conditional"){
            inspectMarkers(node.yes);inspectMarkers(node.no);
          }else if(node.kind==="keyed"){
            inspectMarkers(node.rows);
          }
        }
      };
      inspectMarkers(nodes);
    }
    const templateDigest = hash(JSON.stringify(limits ? {nodes,limits} : nodes));
    const markerId = hash("zaakiy-region-root:" + request.routeId + ":" + templateDigest).slice(0, 32);
    const hydrationPlan: RegionHydrationPlanV2 = {
      schema: "zaakiy.region-hydration/2", routeId: request.routeId, markerId, templateDigest, nodes,
      ...(limits ? {limits}: {})
    };
    // Only compiler-validated data literals are embedded. The code has no
    // TSX evaluator, dynamic import, arbitrary JavaScript or client dependency.
    const code = [
      'export const protocol = "zaakiy.render/1";',
      "export const hydrationPlan = " + JSON.stringify(hydrationPlan) + ";",
      "const dataMarker=(id,side)=>" + (large
        ? "'z-d:'+id.slice(0,16)+':'+(side==='start'?'s':'e')"
        : "'zaakiy-d2:'+id+':'+side") + ";",
      "const keyedMarker=(id,key,side)=>" + (large
        ? "'z-k:'+key+':'+(side==='start'?'s':'e')"
        : "'zaakiy-k2:'+id+':'+key+':'+side") + ";",
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
      " for (const node of nodes) { if (++budget.count > " + String(limits?.maxNodes??8192) + ") throw new RangeError('H4 output node bound');",
      " if (node.kind === 'literal') result += escape(node.value);",
      " else if (node.kind === 'data') result += '<!--' + dataMarker(node.id,'start') + '-->' + text(own(node.source === 'item' ? item : props, node.path)) + '<!--' + dataMarker(node.id,'end') + '-->';",
      " else if (node.kind === 'element') { result += '<' + node.tag + node.attrs.join('') + '>';",
      " if (node.children.length) result += draw(node.children,props,item,budget,depth+1);",
      " if (!" + JSON.stringify([...SSR_VOID_TAGS]) + ".includes(node.tag)) result += '</' + node.tag + '>'; }",
      " else if (node.kind === 'component') { result += '<!--zaakiy-r2:' + node.id + ':start-->';",
      " result += draw(node.children,props,item,budget,depth+1);",
      " result += '<!--zaakiy-r2:' + node.id + ':end-->'; }",
      " else if (node.kind === 'conditional') { result += '<!--zaakiy-r2:' + node.id + ':start-->';",
      " result += draw(own(node.source === 'item' ? item : props,node.path) ? node.yes : node.no,props,item,budget,depth+1);",
      " result += '<!--zaakiy-r2:' + node.id + ':end-->'; }",
      " else if (node.kind === 'keyed') { const rows = own(node.source === 'item' ? item : props,node.path);",
      " if (!Array.isArray(rows) || rows.length > " + String(limits?.maxRows??4096) + ") throw new TypeError('H4 keyed data must be bounded array');",
      " const keys = new Set(); result += '<!--zaakiy-r2:' + node.id + ':start-->';",
      " for (const row of rows) { const key = own(row,[node.key]);",
      " if (typeof key !== 'string' && typeof key !== 'number') throw new TypeError('H4 key type');",
      " const name = String(key); if (!/^[A-Za-z0-9_.:]{1,64}$/.test(name) || keys.has(name)) throw new TypeError('H4 duplicate/unsafe key');",
      " keys.add(name); result += '<!--' + keyedMarker(node.id,name,'start') + '-->';",
      " result += draw(node.rows, props, row, budget, depth+1);",
      " result += '<!--' + keyedMarker(node.id,name,'end') + '-->'; }",
      " result += '<!--zaakiy-r2:' + node.id + ':end-->'; }",
      " } return result; };",
      "export function render(context) {",
      " if (!context || context.schema !== 'zaakiy.render/1' || context.route?.id !== " + JSON.stringify(request.routeId) + ") throw new TypeError('H4 invalid route');",
      " if (context.request?.signal?.aborted) throw context.request.signal.reason;",

      " const body = '<!--zaakiy-h:' + hydrationPlan.markerId + ':' + hydrationPlan.templateDigest + '-->' + draw(hydrationPlan.nodes,context.loaderData,null,{count:0});",
      " if (body.length > " + String(limits?.maxHtmlBytes??1048576) + ") throw new RangeError('H4 output too large');",
      " return {version:1,status:200,headers:{'content-type':'text/html; charset=utf-8'},body,cache:{scope:'no-store',tags:[]}};",
      "}"
    ].join("\n") + "\n";
    const clientEvents=inlineHandlers.length ? [{
      fileName:request.fileName.replace(/\.[cm]?tsx?$/i,"")+".region.events.js",
      code:"export function createRegionEventResolver(props){return (path,getItem=()=>null)=>{"+
        inlineHandlers.map(handler=>
          "if(path[0]==='zaakiyEvent'&&path[1]==="+JSON.stringify(handler.id)+
          ")return "+handler.body+";").join("")+
        "return undefined;};}\n"
    }] : [];
    return { diagnostics: base.diagnostics, hydrationPlan,clientEvents,
      js: [{ fileName: request.fileName.replace(/\.[cm]?tsx?$/i, "") + ".region.server.js", code }] };
  } catch (error) {
    return reject(error instanceof Error ? error.message : "Unsafe H4 region source", root.span);
  }
}
