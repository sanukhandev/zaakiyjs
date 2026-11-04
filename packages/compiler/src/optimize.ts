import type {
  CompilerDiagnostic, IRDocument, IRNode, StaticElement, IRExpression
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

type JsonRecord = Record<string, unknown>;
function record(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function string(value: unknown): value is string {
  return typeof value === "string";
}
function position(value: unknown): boolean {
  return record(value) && Number.isSafeInteger(value.line) && Number(value.line) >= 1 &&
    Number.isSafeInteger(value.column) && Number(value.column) >= 1 &&
    Number.isSafeInteger(value.offset) && Number(value.offset) >= 0;
}
function span(value: unknown): boolean {
  if (!record(value) || !string(value.file) || !position(value.start) || !position(value.end)) return false;
  const start = value.start as { offset: number };
  const end = value.end as { offset: number };
  return end.offset >= start.offset;
}
function expression(value: unknown): boolean {
  return record(value) && string(value.source) && span(value.span) &&
    ["pure", "impure", "unknown"].includes(String(value.purity)) &&
    typeof value.reactive === "boolean";
}

/** Validate untrusted, serialized IR before running public optimization passes. */
export function validateIR(value: unknown): readonly CompilerDiagnostic[] {
  if (!record(value)) {
    return [{ code: "ZC3001", severity: "error", message: "IR document must be an object." }];
  }
  if (value.irVersion !== IR_SCHEMA_VERSION) {
    return [{
      code: "ZC3002", severity: "error",
      message: "Unsupported IR schema version " + String(value.irVersion) +
        "; compiler requires version " + IR_SCHEMA_VERSION + "."
    }];
  }
  if (!string(value.sourceFile) || !Array.isArray(value.nodes)) {
    return [{ code: "ZC3003", severity: "error", message: "Malformed IR document header." }];
  }
  const errors: CompilerDiagnostic[] = [];
  const identities = new Set<string>();
  const seen = new WeakSet<object>();
  const fail = (message: string): void => {
    errors.push({ code: "ZC3004", severity: "error", message });
  };
  const descendants = (items: unknown, path: string): void => {
    if (!Array.isArray(items)) { fail(path + " must be an array."); return; }
    for (let index = 0; index < items.length; index++) check(items[index], path + "[" + index + "]");
  };
  const check = (node: unknown, path: string): void => {
    if (!record(node)) { fail(path + " is not a valid IR node."); return; }
    if (seen.has(node)) { fail(path + " contains a repeated or cyclic IR node reference."); return; }
    seen.add(node);
    if (!string(node.id) || !node.id || !span(node.span) || !string(node.kind)) {
      fail(path + " requires a non-empty id, valid source span and known kind.");
      return;
    }
    if (identities.has(node.id)) fail(path + " duplicates IR id " + node.id + ".");
    const fields: Record<string, readonly string[]> = {
      StaticText: ["text"],
      StaticElement: ["tag", "namespace", "children"],
      DynamicText: ["expression"],
      PropertyBinding: ["name", "target", "expression"],
      EventBinding: ["name", "expression"],
      ConditionalBlock: ["condition", "whenTrue", "whenFalse"],
      KeyedLoop: ["collection", "key", "body"],
      ComponentCall: ["component", "props"],
      StyleToken: ["token", "variant"],
      CompatFeature: ["feature", "targets"]
    };
    const permitted = new Set(["id", "kind", "span", ...(fields[node.kind] ?? [])]);
    for (const field of Object.keys(node)) {
      if (!permitted.has(field)) fail(path + " contains unknown IR v1 field " + field + ".");
    }

    identities.add(node.id);
    switch (node.kind) {
      case "StaticText":
        if (!string(node.text)) fail(path + ".text must be a string.");
        break;
      case "StaticElement":
        if (!string(node.tag) || !["html", "svg", "mathml"].includes(String(node.namespace))) {
          fail(path + " has an invalid element tag or namespace.");
        }
        descendants(node.children, path + ".children");
        break;
      case "DynamicText":
        if (!expression(node.expression)) fail(path + ".expression must be a valid IRExpression.");
        break;
      case "PropertyBinding":
        if (!string(node.name) ||
            !["property", "attribute", "class", "style"].includes(String(node.target)) ||
            !expression(node.expression)) fail(path + " has an invalid property binding.");
        break;
      case "EventBinding":
        if (!string(node.name) || !expression(node.expression)) {
          fail(path + " has an invalid event binding.");
        }
        break;
      case "ConditionalBlock":
        if (!expression(node.condition)) fail(path + ".condition must be a valid IRExpression.");
        descendants(node.whenTrue, path + ".whenTrue");
        descendants(node.whenFalse, path + ".whenFalse");
        break;
      case "KeyedLoop":
        if (!expression(node.collection) || !expression(node.key)) {
          fail(path + " requires valid collection and key expressions.");
        }
        descendants(node.body, path + ".body");
        break;
      case "ComponentCall":
        if (!string(node.component) || !Array.isArray(node.props) ||
            node.props.some(prop => !record(prop) || prop.kind !== "PropertyBinding")) {
          fail(path + " has an invalid component name or props.");
        }
        descendants(node.props, path + ".props");
        break;
      case "StyleToken":
        if (!string(node.token) || (node.variant !== undefined && !string(node.variant))) {
          fail(path + " has an invalid style token.");
        }
        break;
      case "CompatFeature":
        if (!string(node.feature) || !Array.isArray(node.targets) ||
            node.targets.some(target => !string(target))) {
          fail(path + " has an invalid compatibility feature.");
        }
        break;
      default:
        fail(path + " uses unknown IR node kind " + String(node.kind) + ".");
    }
  };
  descendants(value.nodes, "nodes");
  return errors;
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
    case "ConditionalBlock": {
      const condition = node.condition.source.trim();
      const known = node.condition.purity === "pure" && !node.condition.reactive;
      return {
        ...node,
        whenTrue: known && condition === "false" ? [] : node.whenTrue.map(optimizeNode),
        whenFalse: known && condition === "true" ? [] : node.whenFalse.map(optimizeNode)
      };
    }
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
