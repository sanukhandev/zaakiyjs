import * as ts from "typescript";
import type { CompatibilityManifest } from "./types.js";

export interface JavaScriptTransformRequest {
  /** Already-emitted compiler JavaScript, never TSX or user-provided executable plugins. */
  readonly fileName: string;
  readonly code: string;
  readonly manifest: CompatibilityManifest;
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
