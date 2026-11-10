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

/** Finite class branches are required for deterministic CSS token extraction. */
function finiteClassCandidates(node: ts.Expression): readonly ts.StringLiteralLike[] | null {
  const expression = ts.isParenthesizedExpression(node) ? node.expression : node;
  if (expression !== node) return finiteClassCandidates(expression);
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return [node];
  if (ts.isConditionalExpression(node)) {
    const yes = finiteClassCandidates(node.whenTrue);
    const no = finiteClassCandidates(node.whenFalse);
    return yes && no ? [...yes, ...no] : null;
  }
  return null;
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

  // Only imports from the reserved core entrypoint opt in to compiler intrinsics.
  // An unrelated user component named Show or For is never silently hijacked.
  const intrinsics = new Map<string, "Show" | "For" | "Slot">();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) ||
        statement.moduleSpecifier.text !== "@zaakiyjs/core") continue;
    const clause = statement.importClause;
    if (!clause || clause.isTypeOnly || !clause.namedBindings ||
        !ts.isNamedImports(clause.namedBindings)) continue;
    for (const specifier of clause.namedBindings.elements) {
      if (specifier.isTypeOnly) continue;
      const imported = specifier.propertyName?.text ?? specifier.name.text;
      if (imported === "Show" || imported === "For" || imported === "Slot") intrinsics.set(specifier.name.text, imported);
    }
  }

  // Shadowed names cannot be lowered as compiler intrinsics. This also
  // prevents a nested render callback or local variable from accidentally
  // capturing a core import with the same spelling.
  const namesBinding = (binding: ts.BindingName, name: string): boolean => {
    if (ts.isIdentifier(binding)) return binding.text === name;
    return binding.elements.some(part => ts.isBindingElement(part) &&
      namesBinding(part.name, name));
  };
  const isShadowed = (node: ts.Node, name: string): boolean => {
    let ancestor: ts.Node | undefined = node.parent;
    while (ancestor && ancestor !== source) {
      if (ts.isFunctionLike(ancestor) && ancestor.parameters.some(parameter =>
        namesBinding(parameter.name, name))) return true;
      if (ts.isCatchClause(ancestor) && ancestor.variableDeclaration &&
          namesBinding(ancestor.variableDeclaration.name, name)) return true;
      if (ts.isBlock(ancestor)) {
        for (const statement of ancestor.statements) {
          if (ts.isVariableStatement(statement) &&
              statement.declarationList.declarations.some(declaration =>
                namesBinding(declaration.name, name))) return true;
          if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) &&
              statement.name?.text === name) return true;
        }
      }
      ancestor = ancestor.parent;
    }
    return false;
  };

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
    if ((name === "ref" && component) || name === "dangerouslySetInnerHTML" ||
        name === "innerHTML" || name === "outerHTML" || name === "srcdoc") {
      report("ZC1003", "Unsupported or unsafe JSX sink: " + name, node);
      return null;
    }
    if (name === "ref" && (!node.initializer || !ts.isJsxExpression(node.initializer) ||
        !node.initializer.expression)) {
      report("ZC2211", "Native JSX ref requires a typed callback expression.", node);
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
    const target: PropertyBinding["target"] = component || name === "ref" || ["value", "checked", "disabled", "selected"].includes(name)
      ? "property" : name === "class" ? "class" : name === "style" ? "style" : "attribute";
    const span = spanOf(source, node);
    // JSX htmlFor maps to the native HTML for attribute, not a custom DOM property.
    const domName = !component && name === "htmlFor" ? "for" : name;
    return { kind: "PropertyBinding", id: idOf("PropertyBinding", span), span, name: domName, target, expression: value };
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
        // Fragments are compile-only grouping syntax; children share the current
        // owner and DOM parent. No synthetic element or runtime JSX factory.
        nodes.push(...childrenOf(child.children, namespace));
      } else if (ts.isJsxExpression(child) && child.expression) {
        const node = child.expression;
        if (request.componentSlots && ts.isPropertyAccessExpression(node) &&
            ts.isIdentifier(node.expression) && node.expression.text === "props" &&
            node.name.text === "children") {
          const span = spanOf(source, child);
          nodes.push({ kind: "SlotOutlet", id: idOf("SlotOutlet", span), span, name: "children" });
          continue;
        }
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
          const itemParameter = callback && ts.isArrowFunction(callback) &&
            callback.parameters.length === 1 && ts.isIdentifier(callback.parameters[0]!.name)
            ? callback.parameters[0]!.name.text : undefined;
          const template = callback && ts.isArrowFunction(callback) ?
            (ts.isParenthesizedExpression(callback.body) ? callback.body.expression : callback.body) : undefined;
          const itemNode = template && isJsx(template) ? template : undefined;
          const jsxAttrs = itemNode && (ts.isJsxElement(itemNode)
            ? itemNode.openingElement.attributes.properties : itemNode.attributes.properties);
          const keyAttr = jsxAttrs?.find(a => ts.isJsxAttribute(a) && a.name.getText(source) === "key");
          if (!itemParameter || !itemNode || node.arguments.length !== 1 ||
              !keyAttr || !ts.isJsxAttribute(keyAttr) ||
              !keyAttr.initializer || !ts.isJsxExpression(keyAttr.initializer) ||
              !keyAttr.initializer.expression) {
            report("ZC2103", "Keyed array.map requires one named item parameter and a single JSX root with an explicit key expression.", child);
          }
          const key = keyAttr && ts.isJsxAttribute(keyAttr) && keyAttr.initializer &&
            ts.isJsxExpression(keyAttr.initializer) && keyAttr.initializer.expression
            ? expression(keyAttr.initializer.expression) : expression(node.expression.expression);
          nodes.push({
            kind: "KeyedLoop", id: idOf("KeyedLoop", span), span,
            collection: expression(node.expression.expression), key,
            itemParameter,
            body: itemNode ? [element(itemNode, namespace, true)] : []
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
                   parentNamespace: StaticElement["namespace"],
                   inKeyedLoop = false): IRNode => {
    const opening = ts.isJsxElement(node) ? node.openingElement : node;
    const tag = opening.tagName.getText(source);
    const span = spanOf(source, node);

    const intrinsic = intrinsics.get(tag);
    if (intrinsic && !isShadowed(opening, tag)) {
      const attrs = opening.attributes.properties;
      const expected = intrinsic === "Show" ? ["when", "fallback"] :
        intrinsic === "For" ? ["each", "by"] : ["name"];
      const names = new Set<string>();
      for (const attr of attrs) {
        if (!ts.isJsxAttribute(attr)) {
          report("ZC2401", "Compiler control-flow tags do not accept spread props.", attr);
          continue;
        }
        const name = attr.name.getText(source);
        if (!expected.includes(name) || names.has(name)) {
          report("ZC2401", "Unexpected or duplicate " + intrinsic + " prop: " + name, attr);
        }
        names.add(name);
      }
      const getAttribute = (name: string): ts.JsxAttribute | undefined =>
        attrs.find((part): part is ts.JsxAttribute =>
          ts.isJsxAttribute(part) && part.name.getText(source) === name);
      const getValue = (name: string, required: boolean): ts.Expression | undefined => {
        const attr = getAttribute(name);
        if (!attr) {
          if (required) report("ZC2402", intrinsic + " requires {" + name + "} expression.", opening);
          return undefined;
        }
        if (!attr.initializer || !ts.isJsxExpression(attr.initializer) ||
            !attr.initializer.expression) {
          report("ZC2402", intrinsic + " prop " + name + " must be a JSX expression.", attr);
          return undefined;
        }
        return attr.initializer.expression;
      };
      const unwrapped = (input: ts.Expression): ts.Expression => {
        let current = input;
        while (ts.isParenthesizedExpression(current)) current = current.expression;
        return current;
      };
      const asNodes = (input: ts.Expression | undefined): IRNode[] => {
        if (!input) return [];
        const candidate = unwrapped(input);
        if (isJsx(candidate)) return [element(candidate, parentNamespace)];
        if (ts.isJsxFragment(candidate)) return childrenOf(candidate.children, parentNamespace);
        return [];
      };
      const children = ts.isJsxElement(node)
        ? node.children.filter(child => !(ts.isJsxText(child) && !child.text.trim()))
        : [];
      if (intrinsic === "Slot") {
        const nameAttr = getAttribute("name");
        const rawName = nameAttr?.initializer && ts.isStringLiteral(nameAttr.initializer)
          ? nameAttr.initializer.text : null;
        if (!request.componentSlots) {
          report("ZC2503", "Named Slot requires componentSlots: true.", node);
          return { kind: "StaticText", id: idOf("StaticText", span), span, text: "" };
        }
        if (children.length || !rawName || !/^[a-z][a-z0-9_-]{0,31}$/.test(rawName)) {
          report("ZC2503", "Named Slot requires a static safe name and no JSX children.", node);
        }
        return { kind: "SlotOutlet", id: idOf("SlotOutlet", span), span,
          name: rawName && /^[a-z][a-z0-9_-]{0,31}$/.test(rawName) ? rawName : "children" };
      }
      if (intrinsic === "Show") {
        const when = getValue("when", true);
        const fallback = getValue("fallback", false);
        // Direct sibling roots and explicit JSX fragments are both represented
        // by the existing ConditionalBlock.whenTrue/whenFalse arrays in IR v1.
        const rendered: IRNode[] = [];
        for (const direct of children) {
          if (isJsx(direct)) rendered.push(element(direct, parentNamespace));
          else if (ts.isJsxFragment(direct)) rendered.push(...childrenOf(direct.children, parentNamespace));
          else report("ZC2403", "Show children must be JSX nodes or fragments.", direct);
        }
        const alternate = asNodes(fallback);
        if (fallback && !alternate.length &&
            unwrapped(fallback).kind !== ts.SyntaxKind.NullKeyword) {
          report("ZC2403", "Show fallback must be JSX or a fragment (or null).", fallback);
        }
        if (!children.length) report("ZC2403", "Show requires JSX children.", node);
        return {
          kind: "ConditionalBlock", id: idOf("ConditionalBlock", span), span,
          condition: when ? expression(when) : { source: "false", span, purity: "pure", reactive: false },
          whenTrue: rendered,
          whenFalse: alternate
        };
      }

      const collection = getValue("each", true);
      const by = getValue("by", true);
      const direct = children[0];
      const fn = direct && ts.isJsxExpression(direct) && direct.expression
        ? unwrapped(direct.expression) : undefined;
      const callback = fn && ts.isArrowFunction(fn) ? fn : undefined;
      const itemParameter = callback?.parameters.length === 1 &&
        ts.isIdentifier(callback.parameters[0]!.name)
        ? callback.parameters[0]!.name.text : undefined;
      const body = callback && ts.isExpression(callback.body) ? asNodes(callback.body) : [];
      if (children.length !== 1 || !itemParameter || !body.length) {
        report("ZC2404", "For requires one child render callback (item => JSX or fragment).", node);
      }
      if (by && (!ts.isArrowFunction(unwrapped(by)) && !ts.isIdentifier(unwrapped(by)) ||
          containsJsx(by))) {
        report("ZC2405", "For by requires an inline arrow function or stable named function reference; arbitrary calls/accessors are not safe key selectors.", by);
      }
      // Evaluate the supplied key selector with the bound item. Names in the
      // selector callback do not need to match the render callback parameter.
      // The DOM region validates primitives/duplicates before mutating the tree.
      const keySource = by && itemParameter
        ? "((" + by.getText(source) + ")(" + itemParameter + "))"
        : "undefined";
      return {
        kind: "KeyedLoop", id: idOf("KeyedLoop", span), span,
        collection: collection ? expression(collection)
          : { source: "[]", span, purity: "pure", reactive: false },
        key: { source: keySource, span: by ? spanOf(source, by) : span, purity: "unknown", reactive: false },
        itemParameter,
        body
      };
    }

    const isComponent = /^[A-Z]/.test(tag);
    if (!/^[a-zA-Z][\w:.-]*$/.test(tag)) report("ZC1001", "Unsupported JSX tag name: " + tag, opening);
    const namespace = tag === "svg" ? "svg" : parentNamespace;
    if (tag === "foreignObject") report("ZC2107", "SVG foreignObject namespace switching is not supported.", node);
    const props: PropertyBinding[] = [];
    const namedSlots: Array<{ name: string; children: IRNode[] }> = [];
    const attributes: IRNode[] = [];
    for (const attr of opening.attributes.properties) {
      if (ts.isJsxSpreadAttribute(attr)) {
        report("ZC1002", "JSX spread attributes are not supported until evaluation-order semantics are frozen.", attr);
        continue;
      }
      const name = attr.name.getText(source);
      // Key is consumed as a stable compiler loop identity; never emit to DOM.
      if (inKeyedLoop && name === "key") continue;
      if (request.componentSlots && isComponent && attr.initializer &&
          ts.isJsxExpression(attr.initializer) && attr.initializer.expression &&
          (isJsx(attr.initializer.expression) || ts.isJsxFragment(attr.initializer.expression))) {
        const sourceNode = attr.initializer.expression;
        const nodes = isJsx(sourceNode) ? [element(sourceNode, parentNamespace)]
          : childrenOf(sourceNode.children, parentNamespace).filter(
            child => child.kind !== "StaticText" || Boolean(child.text.trim())
          );
        if (name === "children" || !/^[a-z][a-z0-9_-]{0,31}$/.test(name) ||
            namedSlots.some(slot => slot.name === name) ||
            props.some(prop => prop.name === name) || !nodes.length) {
          report("ZC2504", "Named JSX slot props must be unique safe names with JSX content; children is reserved.", attr);
        } else {
          namedSlots.push({ name, children: nodes });
        }
        continue;
      }
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
          const direct = attr.initializer && ts.isStringLiteral(attr.initializer)
            ? attr.initializer
            : attr.initializer && ts.isJsxExpression(attr.initializer) &&
              attr.initializer.expression && ts.isStringLiteral(attr.initializer.expression)
              ? attr.initializer.expression : undefined;
          const isDirect = direct !== undefined;
          const candidates = direct ? [direct]
            : attr.initializer && ts.isJsxExpression(attr.initializer) &&
              attr.initializer.expression ? finiteClassCandidates(attr.initializer.expression) : null;
          if (!candidates) {
            report("ZC2212",
              "Dynamic classes require finite string-literal branches for deterministic CSS extraction.",
              attr);
          } else {
            const tokens = new Map<string, SourceSpan>();
            for (const literal of candidates) {
              const raw = literal.getText(source).slice(1, -1);
              // Escapes cannot be assigned an exact unambiguous stylesheet offset.
              if (raw !== literal.text) {
                report("ZC2213", "Class literal escapes require a verifiable source token span.", literal);
                continue;
              }
              for (const match of raw.matchAll(/\S+/g)) {
                const token = match[0];
                if (token && !tokens.has(token)) {
                  const offset = literal.getStart(source) + 1 + (match.index ?? 0);
                  tokens.set(token, isDirect ? b.span : sourceSpan(source, offset, offset + token.length));
                }
              }
            }
            for (const [token, span] of tokens) {
              attributes.push({ kind: "StyleToken", id: idOf("StyleToken:" + token, span),
                span, token });
            }
          }
        }
      }
    }
    if (isComponent) {
      if (!request.componentSlots) {
        if (ts.isJsxElement(node) && node.children.length) {
          report("ZC2102", "Component children contract is not frozen; pass explicit typed props.", node);
        }
        return { kind: "ComponentCall", id: idOf("ComponentCall", span), span, component: tag, props };
      }
      const children = ts.isJsxElement(node) ? childrenOf(node.children, parentNamespace).filter(
        child => child.kind !== "StaticText" || Boolean(child.text.trim())
      ) : [];
      if (namedSlots.some(slot => props.some(prop => prop.name === slot.name))) {
        report("ZC2504", "A named slot cannot also be assigned a regular component prop.", opening);
      }
      if (children.length && props.some(prop => prop.name === "children")) {
        report("ZC2501", "Explicit children prop conflicts with compiled JSX child slot.", opening);
      }
      return { kind: "ComponentCall", id: idOf("ComponentCall", span), span, component: tag, props,
        ...(children.length ? { children } : {}),
        ...(namedSlots.length ? { slots: namedSlots } : {}) };
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
    document: { irVersion: request.componentSlots ? 2 : 1, sourceFile: fileName, nodes: [...roots.values()] }
  };
}
