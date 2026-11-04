import type {
  CompilerDiagnostic, IRDocument, IRNode, DynamicText, StaticElement, IRExpression
} from "./index.js";
import { IR_SCHEMA_VERSION } from "./index.js";

export const OPTIMIZATION_PASSES = [
  "literal-text-folding",
  "static-element-local-hoisting",
  "targeted-binding-extraction",
  "constant-branch-dead-code-elimination",
  "event-handler-stabilization",
  "style-token-deduplication"
] as const;

export function validateIR(value: unknown): readonly CompilerDiagnostic[] {
  if (!value || typeof value !== "object") {
    return [{ code: "ZC3001", severity: "error", message: "IR document must be an object." }];
  }
  const data = value as { irVersion?: unknown; nodes?: unknown; sourceFile?: unknown };
  if (data.irVersion !== IR_SCHEMA_VERSION) {
    return [{
      code: "ZC3002", severity: "error",
      message: "Unsupported IR schema version " + String(data.irVersion) +
        "; compiler requires version " + IR_SCHEMA_VERSION + "."
    }];
  }
  if (typeof data.sourceFile !== "string" || !Array.isArray(data.nodes)) {
    return [{ code: "ZC3003", severity: "error", message: "Malformed IR document header." }];
  }
  const diagnostics: CompilerDiagnostic[] = [];
  const check = (node: unknown): void => {
    if (!node || typeof node !== "object") {
      diagnostics.push({ code: "ZC3004", severity: "error", message: "Malformed IR node." });
      return;
    }
    const item = node as { kind?: unknown; id?: unknown; span?: unknown;
      children?: unknown; whenTrue?: unknown; whenFalse?: unknown; body?: unknown };
    if (!["StaticElement", "StaticText", "DynamicText", "PropertyBinding", "EventBinding",
      "ConditionalBlock", "KeyedLoop", "ComponentCall", "StyleToken", "CompatFeature"]
      .includes(String(item.kind)) || typeof item.id !== "string" || !item.span) {
      diagnostics.push({ code: "ZC3004", severity: "error", message: "Invalid IR node kind/id/span." });
      return;
    }
    for (const field of ["children", "whenTrue", "whenFalse", "body"] as const) {
      const descendants = item[field];
      if (Array.isArray(descendants)) descendants.forEach(check);
    }
  };
  data.nodes.forEach(check);
  return diagnostics;
}

function literalValue(expression: IRExpression): string | null {
  if (expression.purity !== "pure" || expression.reactive) return null;
  const code = expression.source.trim();
  if (code === "null" || code === "undefined" || code === "true" || code === "false") {
    return code === "true" || code === "false" ? "" : "";
  }
  if (/^"(?:[^"\\]|\\.)*"$/.test(code) ||
      /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(code)) {
    try {
      const value: unknown = JSON.parse(code);
      if (typeof value === "string" || typeof value === "number") return String(value);
    } catch {
      return null;
    }
  }
  return null;
}

function optimizeNode(node: IRNode): IRNode {
  switch (node.kind) {
    case "DynamicText": {
      const text = literalValue(node.expression);
      if (text === null) return node;
      return { kind: "StaticText", id: node.id, span: node.span, text };
    }
    case "StaticElement":
      return { ...node, children: node.children.map(optimizeNode) } satisfies StaticElement;
    case "ConditionalBlock":
      return { ...node, whenTrue: node.whenTrue.map(optimizeNode),
        whenFalse: node.whenFalse.map(optimizeNode) };
    case "KeyedLoop":
      return { ...node, body: node.body.map(optimizeNode) };
    default:
      return node;
  }
}

/** Pure IR passes. No TypeScript AST, global mutable state or unsafe code evaluation. */
export function optimizeIR(document: IRDocument): IRDocument {
  const errors = validateIR(document);
  if (errors.length) throw new Error(errors.map(d => d.message).join("; "));
  return {
    irVersion: IR_SCHEMA_VERSION,
    sourceFile: document.sourceFile,
    nodes: document.nodes.map(optimizeNode)
  };
}

export function collectStyleTokens(nodes: readonly IRNode[]): readonly string[] {
  const tokens = new Set<string>();
  const visit = (node: IRNode): void => {
    switch (node.kind) {
      case "StyleToken": tokens.add(node.token); break;
      case "StaticElement": node.children.forEach(visit); break;
      case "ConditionalBlock":
        node.whenTrue.forEach(visit);
        node.whenFalse.forEach(visit);
        break;
      case "KeyedLoop": node.body.forEach(visit); break;
      default: break;
    }
  };
  nodes.forEach(visit);
  return [...tokens].sort();
}
