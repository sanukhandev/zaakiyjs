import * as ts from "typescript";
import type {
  CompilerDiagnostic, CompileRequest, IRDocument, IRExpression, IRNode,
  SourceSpan, Purity, PropertyBinding, StaticElement
} from "./index.js";

export interface Analysis {
  readonly sourceFile: ts.SourceFile;
  readonly document: IRDocument;
  readonly roots: ReadonlyMap<number, IRNode>;
  readonly diagnostics: readonly CompilerDiagnostic[];
}

function normalizedFile(file: string, root?: string): string {
  const value = file.replace(/\\/g, "/");
  const prefix = root?.replace(/\\/g, "/").replace(/\/$/, "");
  return prefix && value.startsWith(prefix + "/") ? value.slice(prefix.length + 1) : value;
}

export function sourceSpan(source: ts.SourceFile, start: number, end: number): SourceSpan {
  const at = (offset: number) => {
    const pos = source.getLineAndCharacterOfPosition(offset);
    return { line: pos.line + 1, column: pos.character + 1, offset };
  };
  return { file: source.fileName, start: at(start), end: at(end) };
}

function spanOf(source: ts.SourceFile, node: ts.Node): SourceSpan {
  return sourceSpan(source, node.getStart(source), node.getEnd());
}

function idOf(kind: string, span: SourceSpan): string {
  return kind + ":" + span.start.offset + ":" + span.end.offset;
}

function purityOf(node: ts.Expression): Purity {
  if (ts.isParenthesizedExpression(node)) return purityOf(node.expression);
  if (ts.isStringLiteralLike(node) || ts.isNumericLiteral(node) ||
      node.kind === ts.SyntaxKind.TrueKeyword || node.kind === ts.SyntaxKind.FalseKeyword ||
      node.kind === ts.SyntaxKind.NullKeyword || ts.isArrowFunction(node) ||
      ts.isFunctionExpression(node)) return "pure";
  if (ts.isPrefixUnaryExpression(node) &&
      [ts.SyntaxKind.PlusToken, ts.SyntaxKind.MinusToken, ts.SyntaxKind.ExclamationToken]
        .includes(node.operator)) return purityOf(node.operand);
  if (ts.isBinaryExpression(node) && purityOf(node.left) === "pure" &&
      purityOf(node.right) === "pure" &&
      [ts.SyntaxKind.PlusToken, ts.SyntaxKind.MinusToken, ts.SyntaxKind.AsteriskToken,
        ts.SyntaxKind.SlashToken].includes(node.operatorToken.kind)) return "pure";
  if (ts.isCallExpression(node) || ts.isNewExpression(node) ||
      ts.isAwaitExpression(node) || ts.isYieldExpression(node) ||
      ts.isDeleteExpression(node) || ts.isPostfixUnaryExpression(node)) return "unknown";
  return "unknown";
}

function containsReactiveRead(node: ts.Node, names: ReadonlySet<string>): boolean {
  // A function literal is not executed merely by constructing an event handler.
  if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) return false;
  // An immediately invoked closure may read signals and must not become a static snapshot.
  if (ts.isCallExpression(node)) {
    const callee = ts.isParenthesizedExpression(node.expression)
      ? node.expression.expression : node.expression;
    if ((ts.isArrowFunction(callee) || ts.isFunctionExpression(callee)) &&
        ts.forEachChild(callee, child => containsReactiveRead(child, names) || undefined)) {
      return true;
    }
  }
  // Signal references can be aliases, imported bindings or props.state.value.
  // Conservatively track any .value read; the runtime effect records actual
  // signal subscriptions dynamically, so ordinary object properties remain safe.
  if (ts.isPropertyAccessExpression(node) && node.name.text === "value") return true;
  if (ts.isElementAccessExpression(node) && node.argumentExpression &&
      ts.isStringLiteral(node.argumentExpression) && node.argumentExpression.text === "value") return true;
  return ts.forEachChild(node, child => containsReactiveRead(child, names) || undefined) ?? false;
}

function containsJsx(node: ts.Node): boolean {
  if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)) return true;
  return ts.forEachChild(node, child => containsJsx(child) || undefined) ?? false;
}

function containsCall(node: ts.Node): boolean {
  if (ts.isCallExpression(node) || ts.isNewExpression(node)) return true;
  return ts.forEachChild(node, child => containsCall(child) || undefined) ?? false;
}

function isJsx(node: ts.Node): node is ts.JsxElement | ts.JsxSelfClosingElement {
  return ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node);
}

export function analyze(request: CompileRequest): Analysis {
  const fileName = normalizedFile(request.fileName, request.rootDir);
  const source = ts.createSourceFile(fileName, request.source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
  const diagnostics: CompilerDiagnostic[] = [];
  const roots = new Map<number, IRNode>();
  const reactiveNames = new Set<string>();
  const report = (code: string, message: string, node: ts.Node): void => {
    diagnostics.push({ code, severity: "error", message, span: spanOf(source, node) });
  };

  const findSignals = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) &&
        node.initializer && ts.isCallExpression(node.initializer) &&
        ts.isIdentifier(node.initializer.expression) &&
        (node.initializer.expression.text === "signal" ||
         node.initializer.expression.text === "computed")) reactiveNames.add(node.name.text);
    ts.forEachChild(node, findSignals);
  };
  findSignals(source);

  const expression = (node: ts.Expression): IRExpression => ({
    source: node.getText(source),
    span: spanOf(source, node),
    purity: purityOf(node),
    reactive: containsReactiveRead(node, reactiveNames)
  });

  const binding = (node: ts.JsxAttribute, component: boolean): PropertyBinding | null => {
    const name = node.name.getText(source);
    if (name === "key") {
      report("ZC1011", "JSX key is reserved; keyed reconciliation requires the coordinated DOM ABI.", node);
      return null;
    }
    if (name === "ref" || name === "dangerouslySetInnerHTML" ||
        name === "innerHTML" || name === "outerHTML" || name === "srcdoc") {
      report("ZC1003", "Unsupported or unsafe JSX sink: " + name, node);
      return null;
    }
    let value: IRExpression;
    if (!node.initializer) {
      value = { source: "true", span: spanOf(source, node), purity: "pure", reactive: false };
    } else if (ts.isStringLiteral(node.initializer)) {
      value = { source: JSON.stringify(node.initializer.text),
        span: spanOf(source, node.initializer), purity: "pure", reactive: false };
    } else if (ts.isJsxExpression(node.initializer) && node.initializer.expression) {
      if (containsJsx(node.initializer.expression)) {
        report("ZC2108", "JSX nested inside attribute expressions requires an explicit supported lowering.", node);
      }
      value = expression(node.initializer.expression);
    } else {
      report("ZC1004", "JSX attribute value cannot be lowered safely.", node);
      return null;
    }
    if (["href", "src", "xlink:href", "formAction"].includes(name)) {
      // The M0 DOM ABI lacks a vetted URL-policy helper. Only inspectable literals
      // can be accepted, and executable/opaque URL schemes must never be emitted.
      const staticString = value.source.startsWith('"') && value.source.endsWith('"');
      const literal = staticString ? String(JSON.parse(value.source)) : null;
      const normalized = literal === null ? "" : [...literal]
        .filter(char => char.charCodeAt(0) > 31).join("").trimStart().toLowerCase();
      if (literal === null || ["javascript:", "data:", "vbscript:"]
        .some(scheme => normalized.startsWith(scheme))) {
        report("ZC1005", "Unsafe or unverified JSX URL. Only inspectable safe string literals are supported.", node);
      }
    }
    const target: PropertyBinding["target"] = component || ["value", "checked", "disabled", "selected"].includes(name)
      ? "property" : name === "class" ? "class" : name === "style" ? "style" : "attribute";
    const span = spanOf(source, node);
    return { kind: "PropertyBinding", id: idOf("PropertyBinding", span), span, name, target, expression: value };
  };

  const childrenOf = (children: ts.NodeArray<ts.JsxChild>, namespace: StaticElement["namespace"]): IRNode[] => {
    const nodes: IRNode[] = [];
    for (const child of children) {
      if (ts.isJsxText(child)) {
        if (child.text.length !== 0) {
          const span = spanOf(source, child);
          nodes.push({ kind: "StaticText", id: idOf("StaticText", span), span, text: child.text });
        }
      } else if (isJsx(child)) {
        nodes.push(element(child, namespace));
      } else if (ts.isJsxFragment(child)) {
        report("ZC2101", "JSX fragments require a frozen fragment/lifetime ABI.", child);
      } else if (ts.isJsxExpression(child) && child.expression) {
        const node = child.expression;
        if (ts.isConditionalExpression(node) && (isJsx(node.whenTrue) || isJsx(node.whenFalse))) {
          const span = spanOf(source, child);
          nodes.push({
            kind: "ConditionalBlock", id: idOf("ConditionalBlock", span), span,
            condition: expression(node.condition),
            whenTrue: isJsx(node.whenTrue) ? [element(node.whenTrue, namespace)] : [],
            whenFalse: isJsx(node.whenFalse) ? [element(node.whenFalse, namespace)] : []
          });
          continue;
        }
        if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken &&
            isJsx(node.right)) {
          const span = spanOf(source, child);
          nodes.push({
            kind: "ConditionalBlock", id: idOf("ConditionalBlock", span), span,
            condition: expression(node.left), whenTrue: [element(node.right, namespace)], whenFalse: []
          });
          continue;
        }
        if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
            node.expression.name.text === "map") {
          const span = spanOf(source, child);
          const callback = node.arguments[0];
          const template = callback && ts.isArrowFunction(callback) ?
            (ts.isParenthesizedExpression(callback.body) ? callback.body.expression : callback.body) : undefined;
          const itemNode = template && isJsx(template) ? template : undefined;
          const jsxAttrs = itemNode && (ts.isJsxElement(itemNode)
            ? itemNode.openingElement.attributes.properties : itemNode.attributes.properties);
          const keyAttr = jsxAttrs?.find(a => ts.isJsxAttribute(a) && a.name.getText(source) === "key");
          if (!keyAttr || !ts.isJsxAttribute(keyAttr) ||
              !keyAttr.initializer || !ts.isJsxExpression(keyAttr.initializer) ||
              !keyAttr.initializer.expression) {
            report("ZC2103", "Keyed list requires an explicit key expression and a frozen loop ABI.", child);
          }
          const key = keyAttr && ts.isJsxAttribute(keyAttr) && keyAttr.initializer &&
            ts.isJsxExpression(keyAttr.initializer) && keyAttr.initializer.expression
            ? expression(keyAttr.initializer.expression) : expression(node.expression.expression);
          nodes.push({
            kind: "KeyedLoop", id: idOf("KeyedLoop", span), span,
            collection: expression(node.expression.expression), key, body: itemNode ? [element(itemNode, namespace)] : []
          });
          continue;
        }
        if (containsJsx(node)) {
          report("ZC2108", "JSX nested in an unsupported child expression cannot be emitted safely.", node);
        }
        const span = spanOf(source, child);
        const value = expression(node);
        if (value.reactive && containsCall(node)) {
          report("ZC2106", "Reactive expression contains an unknown call; move it into a computed or prove purity.", node);
        }
        nodes.push({ kind: "DynamicText", id: idOf("DynamicText", span), span, expression: value });
      }
    }
    return nodes;
  };

  const element = (node: ts.JsxElement | ts.JsxSelfClosingElement,
                   parentNamespace: StaticElement["namespace"]): IRNode => {
    const opening = ts.isJsxElement(node) ? node.openingElement : node;
    const tag = opening.tagName.getText(source);
    const span = spanOf(source, node);
    const isComponent = /^[A-Z]/.test(tag);
    if (!/^[a-zA-Z][\w:.-]*$/.test(tag)) report("ZC1001", "Unsupported JSX tag name: " + tag, opening);
    const namespace = tag === "svg" ? "svg" : parentNamespace;
    if (tag === "foreignObject") report("ZC2107", "SVG foreignObject namespace switching is not supported.", node);
    const props: PropertyBinding[] = [];
    const attributes: IRNode[] = [];
    for (const attr of opening.attributes.properties) {
      if (ts.isJsxSpreadAttribute(attr)) {
        report("ZC1002", "JSX spread attributes are not supported until evaluation-order semantics are frozen.", attr);
        continue;
      }
      const name = attr.name.getText(source);
      if (!isComponent && /^on/i.test(name) && !/^on[A-Z]/.test(name)) {
        report("ZC1006", "Inline event attributes must use typed onEvent handlers, not HTML on* strings.", attr);
        continue;
      }
      if (!isComponent && /^on[A-Z]/.test(name)) {
        const b = binding(attr, false);
        if (b) attributes.push({
          kind: "EventBinding", id: idOf("EventBinding", b.span), span: b.span,
          name: name.slice(2).toLowerCase(), expression: b.expression
        });
      } else {
        const b = binding(attr, isComponent);
        if (!b) continue;
        if (isComponent) props.push(b);
        else attributes.push(b);
        if (!isComponent && name === "class") {
          const classLiteral = attr.initializer && ts.isStringLiteral(attr.initializer)
            ? attr.initializer.text
            : attr.initializer && ts.isJsxExpression(attr.initializer) &&
              attr.initializer.expression && ts.isStringLiteral(attr.initializer.expression)
              ? attr.initializer.expression.text : null;
          if (classLiteral !== null) {
            for (const token of classLiteral.trim().split(/\s+/).filter(Boolean)) {
              attributes.push({ kind: "StyleToken", id: idOf("StyleToken:" + token, b.span),
                span: b.span, token });
            }
          }
        }
      }
    }
    if (isComponent) {
      if (ts.isJsxElement(node) && node.children.length) {
        report("ZC2102", "Component children contract is not frozen; pass explicit typed props.", node);
      }
      return { kind: "ComponentCall", id: idOf("ComponentCall", span), span, component: tag, props };
    }
    const children = ts.isJsxElement(node) ? childrenOf(node.children, namespace) : [];
    return { kind: "StaticElement", id: idOf("StaticElement", span), span, tag, namespace,
      children: [...attributes, ...children] };
  };

  const scan = (node: ts.Node): void => {
    if (isJsx(node)) {
      roots.set(node.getStart(source), element(node, "html"));
      return;
    }
    if (ts.isJsxFragment(node)) {
      report("ZC2101", "JSX fragment requires a frozen fragment ABI.", node);
      return;
    }
    ts.forEachChild(node, scan);
  };
  scan(source);

  // TypeScript keeps parser diagnostics on its internal SourceFile instance; isolate that access here.
  const syntactic = (source as ts.SourceFile & { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics ?? [];
  for (const diagnostic of syntactic) {
    const start = diagnostic.start ?? 0;
    diagnostics.push({
      code: "ZCTS" + diagnostic.code, severity: "error",
      message: ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
      span: sourceSpan(source, start, start + (diagnostic.length ?? 0))
    });
  }
  return {
    sourceFile: source,
    roots,
    diagnostics,
    document: { irVersion: 1, sourceFile: fileName, nodes: [...roots.values()] }
  };
}
