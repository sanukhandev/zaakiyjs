/**
 * Minimal build-time Node server target for literal-only HTML TSX.
 *
 * Emits a standalone trusted render module, not an interpreter of TSX/IR
 * at request time. Dynamic state, components, events, inline styles and
 * hydration are deliberately rejected until the separate SSR ABI exists.
 */
import type { CompileRequest, CompilerDiagnostic, GeneratedAsset, IRNode, PropertyBinding, SourceSpan } from "./index.js";
import { compile, optimizeIR, parseToIR } from "./index.js";

export interface StaticServerRequest extends CompileRequest {
  readonly routeId: string;
}
export interface StaticServerCompileResult {
  readonly diagnostics: readonly CompilerDiagnostic[];
  readonly js: readonly GeneratedAsset[];
  readonly html?: string;
}

export const SSR_STATIC_TAGS = new Set([
  "main", "div", "section", "article", "header", "footer", "nav", "aside",
  "p", "span", "strong", "em", "small", "h1", "h2", "h3", "h4", "h5", "h6",
  "ul", "ol", "li", "dl", "dt", "dd", "a", "label", "button", "input",
  "textarea", "select", "option", "form", "fieldset", "legend", "img",
  "br", "hr", "table", "thead", "tbody", "tfoot", "tr", "td", "th",
  "blockquote", "pre", "code", "time", "details", "summary"
]);
export const SSR_VOID_TAGS = new Set(["input", "img", "br", "hr"]);
const BOOLEAN = new Set(["checked", "disabled", "selected", "required", "readonly",
  "multiple", "hidden", "open", "autofocus", "novalidate"]);
const GLOBAL = new Set(["id", "class", "title", "role", "lang", "dir", "tabindex",
  "for", "name", "type", "value", "placeholder", "alt", "width", "height",
  "src", "href", "target", "rel", "download", "loading", "rows", "cols",
  "colspan", "rowspan", "method", "action", "autocomplete", "min", "max",
  "step", "accept", "form", "datetime"]);
const ATTRIBUTE_MAP: Readonly<Record<string, string>> = {
  tabIndex: "tabindex", readOnly: "readonly", autoComplete: "autocomplete",
  colSpan: "colspan", rowSpan: "rowspan", noValidate: "novalidate"
};
export const escapeStaticHtml = (raw: string): string =>
  raw.replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
const ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,199}$/;

function staticValue(binding: PropertyBinding): string | number | boolean | null {
  if (binding.expression.reactive || binding.expression.purity !== "pure") {
    throw new Error("Static SSR cannot evaluate reactive or impure attributes");
  }
  let value: unknown;
  try { value = JSON.parse(binding.expression.source) as unknown; }
  catch { throw new Error("Static SSR accepts only literal attributes"); }
  if (value !== null && typeof value !== "string" &&
      typeof value !== "number" && typeof value !== "boolean") {
    throw new Error("Static SSR cannot serialize structured attributes");
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new Error("Static SSR requires finite numeric attributes");
  }
  return value;
}

function safeUrl(value: string): boolean {
  // Only trusted relative paths, fragment links and HTTPS absolute links.
  const normalized = [...value].filter(char => {
    const code = char.charCodeAt(0);
    return code >= 33 && code !== 127;
  }).join("");
  if (value !== value.trim() || normalized !== value || value.startsWith("//") ||
      value.includes("\\") || /%(?:0[0-9a-f]|1[0-9a-f]|2[0-9a-f])/i.test(value)) return false;
  if (value.startsWith("/")) return true;
  if (value.startsWith("#")) return /^#[a-zA-Z0-9_.:-]+$/.test(value);
  if (value.startsWith("https://")) {
    try { const parsed = new URL(value); return parsed.protocol === "https:" && Boolean(parsed.hostname) && !parsed.username && !parsed.password; }
    catch { return false; }
  }
  return false;
}

export function renderLiteralAttribute(binding: PropertyBinding): string {
  if (binding.target === "style" || binding.name === "ref") {
    throw new Error("Static SSR does not support inline styles or refs");
  }
  const name = ATTRIBUTE_MAP[binding.name] ?? binding.name.toLowerCase();
  if (!/^[a-z][a-z0-9:_-]*$/.test(name) || /^on/i.test(name) ||
      (!GLOBAL.has(name) && !BOOLEAN.has(name) &&
       !/^aria-[a-z0-9_-]+$/.test(name) && !/^data-[a-z0-9_-]+$/.test(name))) {
    throw new Error("Static SSR rejects unknown or executable HTML attribute");
  }
  const value = staticValue(binding);
  if (value === null || value === false && BOOLEAN.has(name)) return "";
  if (BOOLEAN.has(name)) return value ? " " + name + '=""' : "";
  const string = String(value);
  if ((name === "href" || name === "src" || name === "action") && !safeUrl(string)) {
    throw new Error("Static SSR rejects unsafe or unverified URLs");
  }
  return " " + name + '="' + escapeStaticHtml(string) + '"';
}

function renderNode(node: IRNode): string {
  if (node.kind === "StaticText") return escapeStaticHtml(node.text);
  if (node.kind === "StyleToken") return "";
  if (node.kind !== "StaticElement" || node.namespace !== "html" ||
      !SSR_STATIC_TAGS.has(node.tag)) throw new Error("Static SSR requires a supported literal HTML element");
  let attrs = "";
  let children = "";
  for (const item of node.children) {
    if (item.kind === "PropertyBinding") attrs += renderLiteralAttribute(item);
    else if (item.kind === "StyleToken") continue;
    else if (item.kind === "EventBinding") {
      throw new Error("Static SSR cannot emit unhydrated event handlers");
    } else children += renderNode(item);
  }
  if (SSR_VOID_TAGS.has(node.tag)) {
    if (children) throw new Error("Void HTML elements cannot have children");
    return "<" + node.tag + attrs + ">";
  }
  return "<" + node.tag + attrs + ">" + children + "</" + node.tag + ">";
}

/**
 * A strictly static SSR module. It can be attested by @zaakiyjs/ssr/build
 * and served by the Node adapter, but intentionally contains no hydration.
 * No user code or expressions are executed at build-time beyond compiler
 * AST/IR analysis; no TSX or compiler is shipped inside the generated module.
 */
export function compileStaticServer(request: StaticServerRequest): StaticServerCompileResult {
  const base = compile(request);
  if (base.diagnostics.some(item => item.severity === "error")) {
    return { js: [], diagnostics: base.diagnostics };
  }
  const reject = (message: string, span?: SourceSpan): StaticServerCompileResult => ({
    js: [],
    diagnostics: [...base.diagnostics, {
      code: "ZSSR1001", severity: "error" as const, message,
      ...(span ? { span } : {})
    }]
  });
  if (!ID.test(request.routeId)) return reject("Static SSR requires a safe route identifier");
  const parsed = parseToIR(request);
  const optimized = optimizeIR(parsed.document);
  if (optimized.nodes.length !== 1 || optimized.nodes[0]?.kind !== "StaticElement") {
    return reject("Static SSR requires exactly one root literal element");
  }
  let html: string;
  try { html = renderNode(optimized.nodes[0]); }
  catch (error) {
    return reject(error instanceof Error ? error.message : "Unsupported static SSR node",
      optimized.nodes[0].span);
  }
  const code = [
    'export const protocol = "zaakiy.render/1";',
    "export function render(context) {",
    '  if (!context || context.schema !== "zaakiy.render/1") throw new TypeError("Invalid SSR context");',
    '  if (context.request.signal.aborted) throw context.request.signal.reason;',
    "  return { version: 1, status: 200,",
    '    headers: { "content-type": "text/html; charset=utf-8" },',
    "    body: " + JSON.stringify(html) + ",",
    '    cache: { scope: "no-store", tags: [] } };',
    "}"
  ].join("\n") + "\n";
  const asset: GeneratedAsset = {
    fileName: request.fileName.replace(/\.[cm]?tsx?$/i, "") + ".server.js",
    code
  };
  return {
    diagnostics: base.diagnostics, js: [asset], html
  };
}
