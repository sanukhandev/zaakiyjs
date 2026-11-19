import * as ts from "typescript";
import type { CompatibilityManifest } from "./types.js";

export interface JavaScriptTransformRequest {
  /** Already-emitted compiler JavaScript, never TSX or user-provided executable plugins. */
  readonly fileName: string;
  readonly code: string;
  readonly manifest: CompatibilityManifest;
}
export interface JavaScriptTransformResult {
  readonly code: string;
  /** TypeScript v3 output-to-input map, for chaining by the host bundler. */
  readonly map: string | null;
}

/**
 * Source-map-preserving variant for a controlled bundler renderChunk pass.
 * Without a transform the original output is returned without a fabricated map.
 * Never evaluate input code or execute model-generated passes.
 */
export function transformEmittedJavaScriptWithMap(request: JavaScriptTransformRequest): JavaScriptTransformResult {
  if (!/\.([cm]?js)$/.test(request.fileName) ||
      request.fileName.startsWith("/") || request.fileName.includes("\\") ||
      request.fileName.split("/").some(segment => segment === ".." || segment === ".")) {
    throw new TypeError("Compatibility transforms require a safe relative emitted JavaScript filename.");
  }
  if (request.manifest.mode === "off" || !request.manifest.transforms.length) {
    return { code: request.code, map: null };
  }
  if (request.manifest.transforms.some(item => item.id !== "typescript-5.9.3-es2019")) {
    throw new TypeError("Unapproved compatibility transform requested.");
  }
  const parsed = ts.createSourceFile(request.fileName, request.code, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  let jsx = false;
  const scan = (node: ts.Node): void => {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)) jsx = true;
    ts.forEachChild(node, scan);
  };
  scan(parsed);
  if (jsx || (parsed as ts.SourceFile & {parseDiagnostics?: readonly ts.Diagnostic[]}).parseDiagnostics?.length) {
    throw new TypeError("Compatibility transform refuses uncompiled or invalid JavaScript.");
  }
  const result = ts.transpileModule(request.code, {
    fileName: request.fileName,
    reportDiagnostics: true,
    compilerOptions: {
      target: ts.ScriptTarget.ES2019,
      module: ts.ModuleKind.ESNext,
      sourceMap: true,
      inlineSources: false,
      removeComments: false,
      isolatedModules: true
    }
  });
  const errors = result.diagnostics?.filter(issue => issue.category === ts.DiagnosticCategory.Error) ?? [];
  if (errors.length) throw new TypeError("Approved compatibility transform rejected input: " +
    ts.flattenDiagnosticMessageText(errors[0]!.messageText, "\n"));
  if (!result.sourceMapText) throw new TypeError("Approved compatibility transform omitted its source map.");
  const map: unknown = JSON.parse(result.sourceMapText);
  if (!map || typeof map !== "object" || Array.isArray(map)) throw new TypeError("Invalid generated source map.");
  const record = map as Record<string, unknown>;
  if (record.version !== 3 || !Array.isArray(record.sources) ||
      record.sources.length !== 1 || record.sources[0] !== request.fileName.split("/").at(-1) ||
      typeof record.mappings !== "string") {
    throw new TypeError("Compatibility transform produced a malformed/nonportable source map.");
  }
  // Vite/Rollup owns the final sourceMappingURL and chains this map to the
  // already-produced compiler TSX source maps. Do not emit an obsolete comment.
  const code = result.outputText.replace(/\n?\/\/# sourceMappingURL=[^\n]*\s*$/, "");
  return { code, map: result.sourceMapText };
}

/**
 * Explicit post-emission integration helper. The active Compiler/Vite Plugin
 * does NOT call this. TypeScript 5.9.3 is the pinned transformation engine.
 */
export function transformEmittedJavaScript(request: JavaScriptTransformRequest): string {
  if (!/\.([cm]?js)$/.test(request.fileName)) {
    throw new TypeError("Compatibility transforms accept only emitted JavaScript (.js/.mjs/.cjs).");
  }
  if (request.manifest.mode === "off" || !request.manifest.transforms.length) return request.code;
  if (request.manifest.transforms.some(t => t.id !== "typescript-5.9.3-es2019")) {
    throw new TypeError("Unapproved compatibility transform requested.");
  }
  const parsed = ts.createSourceFile(request.fileName, request.code, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  let hasJsx = false;
  function scan(node: ts.Node): void {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)) hasJsx = true;
    ts.forEachChild(node, scan);
  }
  scan(parsed);
  if (hasJsx) throw new TypeError("Compatibility transform refuses uncompiled JSX.");
  const result = ts.transpileModule(request.code, {
    fileName: request.fileName,
    reportDiagnostics: true,
    compilerOptions: {
      target: ts.ScriptTarget.ES2019,
      module: ts.ModuleKind.ESNext,
      sourceMap: false,
      removeComments: false,
      isolatedModules: true
    }
  });
  const errors = result.diagnostics?.filter(d => d.category === ts.DiagnosticCategory.Error) ?? [];
  if (errors.length) throw new TypeError("TypeScript downlevel transform rejected emitted JavaScript: " +
    ts.flattenDiagnosticMessageText(errors[0]!.messageText, "\n"));
  return result.outputText;
}
