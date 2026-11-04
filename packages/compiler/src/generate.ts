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
        if (node.condition.source.trim() !== "true" &&
            node.condition.source.trim() !== "false") {
          error("ZC2201", "Reactive conditional regions require a coordinated owner/range DOM ABI.", node.span);
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
        if (node.target === "style" && !/^"/.test(node.expression.source)) {
          error("ZC2204", "Style object/string lowering requires an explicit safe style contract.", node.span);
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
  private readonly owner = "__z_owner";

  private variable(prefix: string): string {
    return "__z_" + prefix + "_" + this.serial++;
  }
  private push(source: string): void { this.lines.push(source); }

  private attribute(el: string, node: PropertyBinding): void {
    const expr = "(" + node.expression.source + ")";
    if (node.expression.reactive) {
      this.push("__zBindProperty(" + this.owner + ", " + el + ", " +
        jsLiteral(node.name) + ", () => " + expr + ");");
      return;
    }
    const val = this.variable("value");
    this.push("const " + val + " = " + expr + ";");
    if (node.target === "property") {
      this.push("__zSetProperty(" + el + ", " + jsLiteral(node.name) + ", " + val + ");");
    } else {
      this.push("__zSetAttribute(" + el + ", " + jsLiteral(node.name) + ", " +
        val + " == null ? null : String(" + val + "));");
    }
  }

  private child(node: IRNode, parent?: string): string | undefined {
    let name: string | undefined;
    switch (node.kind) {
      case "StaticElement": {
        name = this.variable("el");
        this.push("const " + name + " = __zCreateElement(" +
          jsLiteral(node.tag) + ", " + jsLiteral(node.namespace) + ");");
        for (const part of node.children) {
          if (part.kind === "PropertyBinding") this.attribute(name, part);
          else if (part.kind === "EventBinding") {
            const handler = this.variable("handler");
            this.push("const " + handler + " = (" + part.expression.source + ") as EventListener;");
            this.push("__zListen(" + this.owner + ", " + name + ", " +
              jsLiteral(part.name) + ", " + handler + ");");
          } else if (part.kind !== "StyleToken" && part.kind !== "CompatFeature") {
            this.child(part, name);
          }
        }
        break;
      }
      case "StaticText":
        name = this.variable("text");
        this.push("const " + name + " = __zCreateText(" + jsLiteral(node.text) + ");");
        break;
      case "DynamicText": {
        name = this.variable("text");
        if (node.expression.reactive) {
          this.push("const " + name + " = __zCreateText(\"\");");
          this.push("__zBindText(" + this.owner + ", " + name + ", () => (" +
            node.expression.source + "));");
        } else {
          const value = this.variable("value");
          this.push("const " + value + " = (" + node.expression.source + ");");
          this.push("const " + name + " = __zCreateText(" + value +
            " == null || typeof " + value + " === \"boolean\" ? \"\" : String(" + value + "));");
        }
        break;
      }
      case "ComponentCall": {
        const scope = this.variable("scope");
        name = this.variable("component");
        const props = node.props.map(prop =>
          jsLiteral(prop.name) + ": (" + prop.expression.source + ")").join(", ");
        this.push("const " + scope + " = __zCreateOwner(" + this.owner + ");");
        this.push("const " + name + " = __zRunWithOwner(" + scope + ", () => " +
          node.component + "({" + props + "}));");
        break;
      }
      case "ConditionalBlock": {
        const constant = node.condition.source.trim() === "true";
        const branch = constant ? node.whenTrue : node.whenFalse;
        for (const branchNode of branch) this.child(branchNode, parent);
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

  public build(node: IRNode): string {
    this.push("const " + this.owner + " = __zGetOwner();");
    this.push("if (" + this.owner + " == null) throw new Error(\"ZC runtime: JSX must execute inside an owner.\");");
    const root = this.child(node);
    this.push("return " + (root ?? '__zCreateText("")') + ";");
    return "(() => {\n" + this.lines.join("\n") + "\n})()";
  }
}

function toExpression(code: string, original: ts.Node, source: ts.SourceFile,
                      context: ts.TransformationContext): ts.Expression {
  const holder = ts.createSourceFile("__zaakiy_emit.ts", "const __zaakiy_result = " + code + ";",
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
    const copy = ts.factory.cloneNode(node);
    ts.setTextRange(copy, { pos: -1, end: -1 });
    return ts.visitEachChild(copy, clone, context);
  };
  const output = ts.visitNode(declaration.initializer, clone) as ts.Expression;
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

  const transformer: ts.TransformerFactory<ts.SourceFile> = context => file => {
    const visit = (node: ts.Node): ts.Node => {
      if (isJsx(node)) {
        const ir = roots.get(node.getStart(analysis.sourceFile));
        if (ir) return toExpression(new Builder().build(ir), node, analysis.sourceFile, context);
      }
      return ts.visitEachChild(node, visit, context);
    };
    const visited = ts.visitEachChild(file, visit, context);
    const dom = runtimeImport("@zaakiyjs/dom/compiler", [
      ["createElement", "__zCreateElement"], ["createText", "__zCreateText"],
      ["setProperty", "__zSetProperty"], ["setAttribute", "__zSetAttribute"],
      ["bindText", "__zBindText"], ["bindProperty", "__zBindProperty"],
      ["listen", "__zListen"]
    ]);
    const core = runtimeImport("@zaakiyjs/core", [
      ["getOwner", "__zGetOwner"], ["createOwner", "__zCreateOwner"],
      ["runWithOwner", "__zRunWithOwner"]
    ]);
    return ts.factory.updateSourceFile(visited, [dom, core, ...visited.statements]);
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
  return ts.getPreEmitDiagnostics(program)
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
}
