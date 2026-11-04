import * as ts from "typescript";
import type {
  CompilerDiagnostic, CompileRequest, GeneratedAsset, IRDocument, IRNode, PropertyBinding, SourceSpan
} from "./index.js";
import type { Analysis } from "./analysis.js";
import { sourceSpan } from "./analysis.js";

function runtimeImport(moduleName: string, names: readonly (readonly [string, string])[]): ts.ImportDeclaration {
  return ts.factory.createImportDeclaration(
    undefined,
    ts.factory.createImportClause(false, undefined, ts.factory.createNamedImports(
      names.map(([name, alias]) =>
        ts.factory.createImportSpecifier(false, ts.factory.createIdentifier(name), ts.factory.createIdentifier(alias)))
    )),
    ts.factory.createStringLiteral(moduleName)
  );
}

function isJsx(node: ts.Node): node is ts.JsxElement | ts.JsxSelfClosingElement {
  return ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node);
}

const jsLiteral = (value: string): string => JSON.stringify(value);

interface AbiAliases {
  readonly createElement: string;
  readonly createText: string;
  readonly setProperty: string;
  readonly setAttribute: string;
  readonly bindText: string;
  readonly bindProperty: string;
  readonly listen: string;
  readonly createRegion: string;
  readonly bindConditionalRegion: string;
  readonly getOwner: string;
  readonly createOwner: string;
  readonly initializeOwnedComponent: string;
}

function allocateRuntimeAliases(source: ts.SourceFile): {
  readonly aliases: AbiAliases; readonly reserved: ReadonlySet<string>;
} {
  const reserved = new Set<string>();
  const scan = (node: ts.Node): void => {
    if (ts.isIdentifier(node)) reserved.add(node.text);
    ts.forEachChild(node, scan);
  };
  scan(source);
  const free = (base: string): string => {
    let name = base;
    let suffix = 1;
    while (reserved.has(name)) name = base + "_" + suffix++;
    reserved.add(name);
    return name;
  };
  return {
    aliases: {
      createElement: free("__zCreateElement"),
      createText: free("__zCreateText"),
      setProperty: free("__zSetProperty"),
      setAttribute: free("__zSetAttribute"),
      bindText: free("__zBindText"),
      bindProperty: free("__zBindProperty"),
      listen: free("__zListen"),
      createRegion: free("__zCreateRegion"),
      bindConditionalRegion: free("__zBindConditionalRegion"),
      getOwner: free("__zGetOwner"),
      createOwner: free("__zCreateOwner"),
      initializeOwnedComponent: free("__zInitializeOwnedComponent")
    },
    reserved
  };
}


export function loweringDiagnostics(document: IRDocument): CompilerDiagnostic[] {
  const errors: CompilerDiagnostic[] = [];
  const error = (code: string, message: string, span: SourceSpan): void => {
    errors.push({ code, severity: "error", message, span });
  };
  const visit = (node: IRNode): void => {
    switch (node.kind) {
      case "StaticElement":
        node.children.forEach(visit);
        break;
      case "ConditionalBlock":
        if (node.whenTrue.length > 1 || node.whenFalse.length > 1) {
          error("ZC2201", "Conditional branches must return at most one DOM root in ABI v1.", node.span);
        }
        node.whenTrue.forEach(visit);
        node.whenFalse.forEach(visit);
        break;
      case "KeyedLoop":
        error("ZC2202", "Keyed loops cannot compile safely: the v1 DOM keyed-loop ABI is not frozen.", node.span);
        break;
      case "PropertyBinding":
        if (node.expression.reactive && node.target !== "property") {
          error("ZC2203", "Reactive class, style and attributes need a distinct safe DOM binding ABI.", node.span);
        }
        if (node.target === "style") {
          error("ZC2204", "Inline style JSX requires a safe per-property style ABI; DOM v1 rejects style attributes.", node.span);
        }
        break;
      case "EventBinding":
        if (node.expression.reactive) {
          error("ZC2205", "Reactive event handler replacement is not defined by DOM ABI v1.", node.span);
        }
        break;
      case "ComponentCall":
        node.props.forEach(prop => {
          if (prop.expression.reactive) {
            error("ZC2206", "Passing a signal value as a component prop would become stale. Pass the signal or introduce an agreed reactive prop contract.", prop.span);
          }
        });
        break;
      case "CompatFeature":
        error("ZC2207", "Compatibility feature transform is not implemented: " + node.feature, node.span);
        break;
      default:
        break;
    }
  };
  document.nodes.forEach(visit);
  return errors;
}

class Builder {
  private serial = 0;
  private readonly lines: string[] = [];
  private readonly spans: SourceSpan[] = [];
  private readonly names: Set<string>;
  private readonly owner: string;

  constructor(private readonly abi: AbiAliases, reserved: ReadonlySet<string>,
              private readonly rootSpan: SourceSpan, injectedOwner?: string) {
    this.names = new Set(reserved);
    this.owner = injectedOwner ?? this.variable("owner");
  }

  private variable(prefix: string): string {
    let name: string;
    do { name = "__z_" + prefix + "_" + this.serial++; }
    while (this.names.has(name));
    this.names.add(name);
    return name;
  }
  private push(code: string, span: SourceSpan = this.rootSpan): void {
    this.lines.push(code);
    this.spans.push(span);
  }

  private attribute(el: string, node: PropertyBinding): void {
    const expr = "(" + node.expression.source + ")";
    if (node.expression.reactive) {
      this.push(this.abi.bindProperty + "(" + this.owner + ", " + el + ", " +
        jsLiteral(node.name) + ", () => " + expr + ");", node.expression.span);
      return;
    }
    const val = this.variable("value");
    this.push("const " + val + " = " + expr + ";");
    if (node.target === "property") {
      this.push(this.abi.setProperty + "(" + el + ", " + jsLiteral(node.name) + ", " + val + ");");
    } else {
      this.push(this.abi.setAttribute + "(" + el + ", " + jsLiteral(node.name) + ", " +
        val + " == null ? null : String(" + val + "));");
    }
  }

  /** Produce an owner-scoped branch factory without leaking its statement spans
   * into the outer JSX IIFE's statement/source-map alignment. */
  private branch(nodes: readonly IRNode[], childOwner: string): string {
    const scoped = new Builder(this.abi, this.names, this.rootSpan, childOwner);
    const root = nodes[0] ? scoped.child(nodes[0]) : undefined;
    return "{\\n" + scoped.lines.join("\\n") + "\\nreturn " +
      (root ?? (this.abi.createText + '(\\"\\")')) + ";\\n}";
  }

  private child(node: IRNode, parent?: string): string | undefined {
    let name: string | undefined;
    switch (node.kind) {
      case "StaticElement": {
        name = this.variable("el");
        this.push("const " + name + " = " + this.abi.createElement + "(" +
          jsLiteral(node.tag) + ", " + jsLiteral(node.namespace) + ");");
        for (const part of node.children) {
          if (part.kind === "PropertyBinding") this.attribute(name, part);
          else if (part.kind === "EventBinding") {
            const handler = this.variable("handler");
            this.push("const " + handler + " = (" + part.expression.source + ") as EventListener;");
            this.push(this.abi.listen + "(" + this.owner + ", " + name + ", " +
              jsLiteral(part.name) + ", " + handler + ");");
          } else if (part.kind !== "StyleToken" && part.kind !== "CompatFeature") {
            this.child(part, name);
          }
        }
        break;
      }
      case "StaticText":
        name = this.variable("text");
        this.push("const " + name + " = " + this.abi.createText + "(" + jsLiteral(node.text) + ");");
        break;
      case "DynamicText": {
        name = this.variable("text");
        if (node.expression.reactive) {
          this.push("const " + name + " = " + this.abi.createText + "(\"\");");
          this.push(this.abi.bindText + "(" + this.owner + ", " + name + ", () => (" +
            node.expression.source + "));", node.expression.span);
        } else {
          const value = this.variable("value");
          this.push("const " + value + " = (" + node.expression.source + ");");
          this.push("const " + name + " = " + this.abi.createText + "(" + value +
            " == null || typeof " + value + " === \"boolean\" ? \"\" : String(" + value + "));");
        }
        break;
      }
      case "ComponentCall": {
        const scope = this.variable("scope");
        name = this.variable("component");
        const props = node.props.map(prop =>
          jsLiteral(prop.name) + ": (" + prop.expression.source + ")").join(", ");
        this.push("const " + scope + " = " + this.abi.createOwner + "(" + this.owner + ");");
        this.push("const " + name + " = " + this.abi.initializeOwnedComponent + "(" + scope + ", () => " +
          node.component + "({" + props + "}));");
        break;
      }
      case "ConditionalBlock": {
        const literal = node.condition.source.trim();
        if (literal === "true" || literal === "false") {
          const branch = literal === "true" ? node.whenTrue : node.whenFalse;
          for (const branchNode of branch) this.child(branchNode, parent);
          return undefined;
        }
        if (!parent) throw new Error("ZC2201: dynamic conditional requires a host parent element");
        const region = this.variable("region");
        const trueOwner = this.variable("true_owner");
        const falseOwner = this.variable("false_owner");
        this.push("const " + region + " = " + this.abi.createRegion + "(" + parent + ");", node.span);
        const trueFactory = "(" + trueOwner + ") => " + this.branch(node.whenTrue, trueOwner);
        const falseFactory = node.whenFalse.length
          ? ", (" + falseOwner + ") => " + this.branch(node.whenFalse, falseOwner) : "";
        this.push(this.abi.bindConditionalRegion + "(" + this.owner + ", " + region +
          ", () => Boolean(" + node.condition.source + "), " + trueFactory + falseFactory + ");", node.span);
        return undefined;
      }
      case "PropertyBinding":
      case "EventBinding":
      case "StyleToken":
      case "CompatFeature":
      case "KeyedLoop":
        return undefined;
    }
    if (name && parent) this.push(parent + ".appendChild(" + name + ");");
    return name;
  }

  public build(node: IRNode): { readonly code: string; readonly spans: readonly SourceSpan[] } {
    this.push("const " + this.owner + " = " + this.abi.getOwner + "();");
    this.push("if (" + this.owner + " == null) throw new Error(\"ZC runtime: JSX must execute inside an owner.\");");
    const root = this.child(node);
    this.push("return " + (root ?? (this.abi.createText + '("")')) + ";");
    return { code: "(() => {\n" + this.lines.join("\n") + "\n})()", spans: this.spans };
  }
}

function toExpression(generated: { readonly code: string; readonly spans: readonly SourceSpan[] },
                      original: ts.Node, source: ts.SourceFile,
                      context: ts.TransformationContext): ts.Expression {
  const holder = ts.createSourceFile("__zaakiy_emit.ts", "const __zaakiy_result = " + generated.code + ";",
    ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  const statement = holder.statements[0];
  if (!statement || !ts.isVariableStatement(statement)) {
    throw new Error("Compiler internal error: failed to parse generated expression.");
  }
  const declaration = statement.declarationList.declarations[0];
  if (!declaration?.initializer || ((holder as ts.SourceFile & { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics?.length ?? 0) > 0) {
    throw new Error("Compiler internal error: generated TypeScript expression is invalid.");
  }
  // Deep-clone as synthetic nodes: parsed nodes carry offsets into a different file.
  // Reusing those positions makes TS's printer splice incorrect original TSX text.
  const clone = (node: ts.Node): ts.Node => {
    // Copy the TS AST data into a synthetic node without relying on private clone APIs.
    const copy: ts.Node = { ...node };
    ts.setTextRange(copy, { pos: -1, end: -1 });
    return ts.visitEachChild(copy, clone, context);
  };
  const output = ts.visitNode(declaration.initializer, clone) as ts.Expression;
  // Attach source ranges to individual generated statements, not just the
  // enclosing JSX expression. A user breakpoint on a reactive binding must
  // lead back to the original TSX binding, not an unmapped synthetic block.
  const callee = ts.isCallExpression(output) && ts.isParenthesizedExpression(output.expression)
    ? output.expression.expression : undefined;
  if (!callee || !ts.isArrowFunction(callee) || !ts.isBlock(callee.body) ||
      callee.body.statements.length !== generated.spans.length) {
    throw new Error("Compiler internal error: generated statement/source mapping mismatch.");
  }
  callee.body.statements.forEach((statement, index) => {
    const span = generated.spans[index];
    if (span) ts.setSourceMapRange(statement, {
      pos: span.start.offset, end: span.end.offset
    });
  });
  ts.setSourceMapRange(output, { pos: original.getStart(source), end: original.getEnd() });
  return output;
}

export function emitJavaScript(request: CompileRequest, analysis: Analysis,
                               optimized: IRDocument): GeneratedAsset {
  const roots = new Map<number, IRNode>();
  let index = 0;
  for (const start of analysis.roots.keys()) {
    const node = optimized.nodes[index++];
    if (node) roots.set(start, node);
  }

  const { aliases, reserved } = allocateRuntimeAliases(analysis.sourceFile);
  const transformer: ts.TransformerFactory<ts.SourceFile> = context => file => {
    let loweredJsx = false;
    const visit = (node: ts.Node): ts.Node => {
      if (isJsx(node)) {
        const ir = roots.get(node.getStart(analysis.sourceFile));
        if (ir) {
          loweredJsx = true;
          return toExpression(new Builder(aliases, reserved, ir.span).build(ir), node, analysis.sourceFile, context);
        }
      }
      return ts.visitEachChild(node, visit, context);
    };
    const visited = ts.visitEachChild(file, visit, context);
    if (!loweredJsx) return visited;
    const dom = runtimeImport("@zaakiyjs/dom/compiler", [
      ["createElement", aliases.createElement], ["createText", aliases.createText],
      ["setProperty", aliases.setProperty], ["setAttribute", aliases.setAttribute],
      ["bindText", aliases.bindText], ["bindProperty", aliases.bindProperty],
      ["listen", aliases.listen], ["createRegion", aliases.createRegion],
      ["bindConditionalRegion", aliases.bindConditionalRegion]
    ]);
    const core = runtimeImport("@zaakiyjs/core", [
      ["getOwner", aliases.getOwner], ["createOwner", aliases.createOwner],
      ["initializeOwnedComponent", aliases.initializeOwnedComponent]
    ]);
    const statements = [...visited.statements];
    let afterDependencies = 0;
    for (let index = 0; index < statements.length; index++) {
      const item = statements[index];
      if (item && (ts.isImportDeclaration(item) || ts.isImportEqualsDeclaration(item) ||
          (ts.isExportDeclaration(item) && item.moduleSpecifier))) afterDependencies = index + 1;
    }
    return ts.factory.updateSourceFile(visited, [
      ...statements.slice(0, afterDependencies), dom, core,
      ...statements.slice(afterDependencies)
    ]);
  };

  const fileName = analysis.sourceFile.fileName;
  const result = ts.transpileModule(request.source, {
    fileName,
    reportDiagnostics: true,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      // No JSX is allowed to survive the transform; this emits .js rather than .jsx assets.
      jsx: ts.JsxEmit.ReactJSX,
      sourceMap: true,
      inlineSources: true,
      newLine: ts.NewLineKind.LineFeed,
      removeComments: false
    },
    transformers: { before: [transformer] }
  });
  const outputName = fileName.replace(/\.tsx?$/i, ".js");
  return {
    fileName: outputName,
    code: result.outputText,
    map: result.sourceMapText
  };
}

export function typeDiagnostics(request: CompileRequest, analysis: Analysis): CompilerDiagnostic[] {
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    // Type-check against the JSX namespace from jsx-runtime; emission still uses preserve + our transformer.
    jsx: ts.JsxEmit.ReactJSX, jsxImportSource: "@zaakiyjs/core",
    strict: true, skipLibCheck: true, noEmit: true, types: []
  };
  const host = ts.createCompilerHost(options);
  const originalRead = host.readFile.bind(host);
  const originalGet = host.getSourceFile.bind(host);
  const targetName = ts.sys.resolvePath(request.fileName);
  host.readFile = path => ts.sys.resolvePath(path) === targetName ? request.source : originalRead(path);
  host.getSourceFile = (path, language, onError, shouldCreate) =>
    ts.sys.resolvePath(path) === targetName ?
      ts.createSourceFile(path, request.source, language, true, ts.ScriptKind.TSX) :
      originalGet(path, language, onError, shouldCreate);
  const program = ts.createProgram([request.fileName], options, host);
  const errors: CompilerDiagnostic[] = ts.getPreEmitDiagnostics(program)
    .filter(d => d.file && ts.sys.resolvePath(d.file.fileName) === targetName)
    .map(d => {
      const start = d.start ?? 0;
      return {
        code: "ZCTS" + d.code,
        severity: d.category === ts.DiagnosticCategory.Error ? "error" as const : "warning" as const,
        message: ts.flattenDiagnosticMessageText(d.messageText, "\n"),
        span: sourceSpan(analysis.sourceFile, start, start + (d.length ?? 0))
      };
    });

  const file = program.getSourceFile(request.fileName);
  if (!file) return errors;
  const checker = program.getTypeChecker();
  const textual = ts.TypeFlags.StringLike | ts.TypeFlags.NumberLike | ts.TypeFlags.BooleanLike |
    ts.TypeFlags.BigIntLike | ts.TypeFlags.Null | ts.TypeFlags.Undefined |
    ts.TypeFlags.VoidLike | ts.TypeFlags.Never;
  const canRenderText = (type: ts.Type): boolean => {
    if (type.isUnion()) return type.types.every(canRenderText);
    if (type.flags & textual) return true;
    if (type.flags & ts.TypeFlags.TypeParameter) {
      const constraint = checker.getBaseConstraintOfType(type);
      return constraint ? canRenderText(constraint) : false;
    }
    return false;
  };
  const hasMarkup = (node: ts.Node): boolean => {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)) return true;
    return ts.forEachChild(node, child => hasMarkup(child) || undefined) ?? false;
  };
  const visit = (node: ts.Node): void => {
    if (ts.isJsxExpression(node) && node.expression &&
        (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent)) &&
        !hasMarkup(node.expression)) {
      const type = checker.getTypeAtLocation(node.expression);
      if (!canRenderText(type)) {
        errors.push({
          code: "ZC2110", severity: "error",
          message: "JSX dynamic text must resolve to string, number, bigint, boolean, null or undefined. Use explicit supported DOM nodes instead of coercing arrays, objects or ViewNodes.",
          span: sourceSpan(analysis.sourceFile,
            node.expression.getStart(file), node.expression.getEnd())
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return errors;
}
