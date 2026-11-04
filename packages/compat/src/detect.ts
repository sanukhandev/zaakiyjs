import * as ts from "typescript";
import type {
  CompatIRDocument, CompatIRNode, CompatibilityDiagnostic, CssFeatureEvidence,
  FeatureReference, FeatureRequirement, SourceInput
} from "./types.js";

export interface DetectionResult {
  readonly requirements: readonly FeatureRequirement[];
  readonly diagnostics: readonly CompatibilityDiagnostic[];
}
function at(file: string, sf: ts.SourceFile, node: ts.Node): FeatureReference {
  const start = node.getStart(sf);
  const pos = sf.getLineAndCharacterOfPosition(start);
  return { origin: "source", file, line: pos.line + 1, column: pos.character + 1, offset: start };
}
/**
 * TypeScript's parser is used only by the build-time entrypoint. This is a
 * conservative syntactic scan, NOT a type-checker/global-symbol resolver.
 */
export function detectSourceFeatures(input: SourceInput): DetectionResult {
  const kind = /\.tsx$/i.test(input.fileName) ? ts.ScriptKind.TSX :
    /\.jsx$/i.test(input.fileName) ? ts.ScriptKind.JSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(input.fileName, input.source, ts.ScriptTarget.Latest, true, kind);
  const requirements: FeatureRequirement[] = [];
  const diagnostics: CompatibilityDiagnostic[] = [];
  const report = (id: string, node: ts.Node): void => {
    requirements.push({ id, reference: at(input.fileName, sf, node) });
  };
  const uncertain = (message: string, node: ts.Node): void => {
    diagnostics.push({ code: "ZK2102", severity: "warning", message, reference: at(input.fileName, sf, node) });
  };
  const abortVariables = new Set<string>();
  function findControllers(node: ts.Node): void {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer &&
      ts.isNewExpression(node.initializer) && ts.isIdentifier(node.initializer.expression) &&
      node.initializer.expression.text === "AbortController") abortVariables.add(node.name.text);
    ts.forEachChild(node, findControllers);
  }
  findControllers(sf);
  function walk(node: ts.Node): void {
    if (ts.isPropertyAccessExpression(node)) {
      if (node.questionDotToken) report("js.optional-chaining", node);
      if (ts.isIdentifier(node.expression) && node.expression.text === "AbortSignal") {
        if (node.name.text === "any") report("web.abort-signal-any", node);
        if (node.name.text === "timeout") report("web.abort-signal-timeout", node);
      }
      if (node.name.text === "reason" &&
        ((ts.isIdentifier(node.expression) && /signal$/i.test(node.expression.text)) ||
         (ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "signal"))) {
        report("web.abort-reason", node);
      }
    }
    if (ts.isElementAccessExpression(node)) {
      if (node.questionDotToken) report("js.optional-chaining", node);
      if (ts.isIdentifier(node.expression) && node.expression.text === "AbortSignal") {
        if (node.argumentExpression && ts.isStringLiteralLike(node.argumentExpression)) {
          if (node.argumentExpression.text === "any") report("web.abort-signal-any", node);
          if (node.argumentExpression.text === "timeout") report("web.abort-signal-timeout", node);
        } else uncertain("Dynamic AbortSignal property access cannot be resolved statically.", node);
      }
    }
    if (ts.isCallExpression(node)) {
      if (node.questionDotToken) report("js.optional-chaining", node);
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) report("module.dynamic-import", node);
      if (ts.isIdentifier(node.expression)) {
        if (node.expression.text === "fetch") report("web.fetch", node);
        if (node.expression.text === "structuredClone") report("web.structured-clone", node);
      }
      if (ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "abort" &&
        node.arguments.length > 0 && ts.isIdentifier(node.expression.expression) &&
        abortVariables.has(node.expression.expression.text)) {
        report("web.abort-reason", node);
      }
    }
    if (ts.isNewExpression(node) && ts.isIdentifier(node.expression)) {
      if (node.expression.text === "AbortController") report("web.abort-controller", node);
      if (node.expression.text === "ResizeObserver") report("web.resize-observer", node);
    }
    if (ts.isBinaryExpression(node)) {
      const op = node.operatorToken.kind;
      if (op === ts.SyntaxKind.QuestionQuestionToken) report("js.nullish-coalescing", node);
      if (op === ts.SyntaxKind.QuestionQuestionEqualsToken || op === ts.SyntaxKind.BarBarEqualsToken ||
          op === ts.SyntaxKind.AmpersandAmpersandEqualsToken) report("js.logical-assignment", node);
    }
    ts.forEachChild(node, walk);
  }
  walk(sf);
  return { requirements, diagnostics };
}
function nodesOf(node: CompatIRNode): readonly CompatIRNode[] {
  return [
    ...(node.children ?? []), ...(node.whenTrue ?? []), ...(node.whenFalse ?? []),
    ...(node.body ?? []), ...(node.props ?? [])
  ];
}
export function detectIRFeatures(document: CompatIRDocument): DetectionResult {
  if (document.irVersion !== 1) {
    return { requirements: [], diagnostics: [{
      code: "ZK2001", severity: "error", message: "Unsupported compiler IR version: " + document.irVersion
    }] };
  }
  const requirements: FeatureRequirement[] = [];
  function visit(node: CompatIRNode): void {
    if (node.kind === "CompatFeature" && node.feature) {
      requirements.push({ id: node.feature, reference: {
        origin: "ir", file: node.span?.file ?? document.sourceFile,
        line: node.span?.start.line, column: node.span?.start.column, offset: node.span?.start.offset
      } });
    }
    for (const nested of nodesOf(node)) visit(nested);
  }
  for (const root of document.nodes) visit(root);
  return { requirements, diagnostics: [] };
}
export function detectStylesFeatures(evidence: readonly CssFeatureEvidence[]): DetectionResult {
  return { requirements: evidence.map(item => ({
    id: item.feature,
    reference: { origin: "css", file: item.file, offset: item.offset }
  })), diagnostics: [] };
}
