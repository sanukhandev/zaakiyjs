import * as compilerModule from "@zaakiyjs/compiler";
import * as stylesModule from "@zaakiyjs/styles";
import type {
  CompileRequest,
  CompileResult,
  CompilerSession,
  CompilerDiagnostic,
  GeneratedAsset
} from "@zaakiyjs/compiler";
import type {
  ExtractedStyleToken,
  StyleCompilerRequest,
  StyleCompilerResult,
  StyleConfig
} from "@zaakiyjs/styles";

/**
 * M0 freezes result shapes, but not executable export names. These adapters are
 * deliberately fail-closed until the separate compiler and styles PRs land.
 * The integration PR must then pin exactly one reviewed public function name.
 */
type CompilerEntry = (request: CompileRequest) => CompileResult | Promise<CompileResult>;
type StylesEntry = (request: StyleCompilerRequest) => StyleCompilerResult | Promise<StyleCompilerResult>;
const compilerExports = compilerModule as unknown as Record<string, unknown>;
const stylesExports = stylesModule as unknown as Record<string, unknown>;

export function hasCompiler(): boolean {
  return typeof compilerExports.compile === "function";
}

export function hasStyles(): boolean {
  return typeof stylesExports.compileStyles === "function";
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertAsset(value: unknown, kind: string): asserts value is GeneratedAsset {
  if (!record(value) || typeof value.fileName !== "string" ||
      typeof value.code !== "string" ||
      (value.map !== undefined && typeof value.map !== "string")) {
    throw new Error("ZV1003: Invalid " + kind + " asset from @zaakiyjs/compiler");
  }
}

export async function invokeCompiler(request: CompileRequest, session?: CompilerSession): Promise<CompileResult> {
  if (!hasCompiler()) {
    throw new Error(
      "ZV1001: @zaakiyjs/compiler has no executable public compile() export. " +
      "The M0 package contains only types; merge and verify the real compiler before enabling TSX builds."
    );
  }
  const value: unknown = await (session
    ? session.compile(request)
    : (compilerExports.compile as CompilerEntry)(request));
  const expectedVersion = request.componentSlots === true ? 2 : 1;
  if (!record(value) || value.irVersion !== expectedVersion ||
      !Array.isArray(value.js) || !Array.isArray(value.css) ||
      !Array.isArray(value.diagnostics)) {
    throw new Error("ZV1002: @zaakiyjs/compiler returned an invalid IR " + expectedVersion + " compilation result");
  }
  for (const js of value.js) assertAsset(js, "JavaScript");
  for (const css of value.css) assertAsset(css, "CSS");
  for (const d of value.diagnostics) {
    if (!record(d) || typeof d.code !== "string" ||
        !["error", "warning", "info"].includes(String(d.severity)) ||
        typeof d.message !== "string") {
      throw new Error("ZV1004: Invalid compiler diagnostic");
    }
  }
  return value as unknown as CompileResult;
}

export async function invokeStyles(request: StyleCompilerRequest): Promise<StyleCompilerResult> {
  if (!hasStyles()) {
    throw new Error(
      "ZV2001: @zaakiyjs/styles has no executable public compileStyles() export. " +
      "The M0 package contains only types; CSS generation cannot fall back to another engine."
    );
  }
  const value: unknown = await (stylesExports.compileStyles as StylesEntry)(request);
  if (!record(value) || typeof value.css !== "string" ||
      !Array.isArray(value.diagnostics) || !record(value.tokenIds)) {
    throw new Error("ZV2002: @zaakiyjs/styles returned an invalid stylesheet result");
  }
  for (const diagnostic of value.diagnostics) {
    if (!record(diagnostic) || typeof diagnostic.code !== "string" ||
        typeof diagnostic.message !== "string") {
      throw new Error("ZV2003: Invalid @zaakiyjs/styles diagnostic");
    }
  }
  return value as unknown as StyleCompilerResult;
}

/**
 * Resolve token offsets only from an authoritative producer.
 *
 * The compiler's legacy string[] manifest contains no source spans. The real
 * styles package exposes a conservative static-literal extractor; it is used
 * only to recover exact positions for tokens already approved by the compiler.
 * Unknown positions are fatal rather than falsely reporting offset 0.
 */
export function hasStyleTokenExtractor(): boolean {
  return typeof stylesExports.extractStyleTokens === "function";
}

export function styleTokensFromResult(
  result: CompileResult,
  file: string,
  source?: string
): ExtractedStyleToken[] {
  const tokens: unknown = result.manifest?.styleTokens;
  if (tokens === undefined) return [];
  if (!Array.isArray(tokens)) {
    throw new Error("ZV2004: Compiler manifest.styleTokens must be an array");
  }

  const unlocated = tokens.some((token: unknown) => typeof token === "string");
  const recovered = new Map<string, ExtractedStyleToken>();
  if (unlocated) {
    if (source === undefined || !hasStyleTokenExtractor()) {
      throw new Error(
        "ZV2011: Compiler emitted style token names without source offsets. " +
        "An executable @zaakiyjs/styles.extractStyleTokens() is required, " +
        "or the compiler must emit ExtractedStyleToken records with exact spans."
      );
    }
    const extractor = stylesExports.extractStyleTokens as
      (source: string, file: string) => unknown;
    const extracted: unknown = extractor(source, file);
    if (!record(extracted) || !Array.isArray(extracted.tokens)) {
      throw new Error("ZV2012: @zaakiyjs/styles extractor returned malformed token metadata");
    }
    for (const token of extracted.tokens as readonly unknown[]) {
      if (!record(token) || typeof token.token !== "string" ||
          token.file !== file || !Number.isSafeInteger(token.offset) ||
          Number(token.offset) < 0 ||
          source.slice(Number(token.offset), Number(token.offset) + token.token.length) !== token.token) {
        throw new Error("ZV2012: @zaakiyjs/styles extractor returned an invalid original-source offset");
      }
      const located: ExtractedStyleToken = {
        token: token.token, file, offset: Number(token.offset)
      };
      if (!recovered.has(located.token)) recovered.set(located.token, located);
    }
  }

  return tokens.map((item: unknown): ExtractedStyleToken => {
    if (typeof item === "string") {
      if (!item.trim()) throw new Error("ZV2005: Empty style token in compiler manifest");
      const located = recovered.get(item);
      if (!located) {
        throw new Error(
          "ZV2013: No verifiable original-source position for compiler style token '" +
          item + "' in " + file + ". The compiler must emit a precise token span."
        );
      }
      return located;
    }
    if (!record(item) || typeof item.token !== "string" || !item.token.trim() ||
        typeof item.offset !== "number" || !Number.isSafeInteger(item.offset) ||
        item.offset < 0 || (item.file !== undefined && typeof item.file !== "string")) {
      throw new Error("ZV2005: Invalid extracted style token in compiler manifest");
    }
    if (item.file === undefined || item.file === file) {
      if (source !== undefined &&
          source.slice(item.offset, item.offset + item.token.length) !== item.token) {
        throw new Error("ZV2014: Compiler style token position does not match original source");
      }
    }
    return {
      token: item.token,
      file: typeof item.file === "string" ? item.file : file,
      offset: item.offset
    };
  });
}

export function assertStyleConfig(value: unknown, filename: string): StyleConfig {
  if (!record(value) || !record(value.brand)) {
    throw new Error("ZV2006: " + filename + " must export a StyleConfig with a brand object");
  }
  for (const name of ["colors", "spacing", "fonts", "radii", "breakpoints"] as const) {
    const group = value.brand[name];
    if (group === undefined) continue;
    if (!record(group) || Object.values(group).some((entry) => typeof entry !== "string")) {
      throw new Error("ZV2007: Invalid brand token group '" + name + "' in " + filename);
    }
  }
  if (value.mode !== undefined && !["light", "dark", "system"].includes(String(value.mode))) {
    throw new Error("ZV2008: Invalid appearance mode in " + filename);
  }
  if (value.safelist !== undefined &&
      (!Array.isArray(value.safelist) || value.safelist.some((x: unknown) => typeof x !== "string"))) {
    throw new Error("ZV2009: Invalid utility safelist in " + filename);
  }
  return value as unknown as StyleConfig;
}

export function formatDiagnostic(diagnostic: CompilerDiagnostic, fallback: string): {
  message: string;
  id: string;
  loc?: { file: string; line: number; column: number };
} {
  const span = diagnostic.span;
  return {
    message: "[" + diagnostic.code + "] " + diagnostic.message,
    id: span?.file ?? fallback,
    ...(span ? { loc: { file: span.file, line: span.start.line, column: span.start.column - 1 } } : {})
  };
}

const forbidden = /^@zaakiyjs\/(?:ai|proxy|compiler|styles|vite-plugin)(?:\/|$)/;
export function forbiddenBrowserImport(specifier: string): boolean {
  return forbidden.test(specifier);
}

export function assertBrowserOutput(code: string, source: string): void {
  const expression = /\b(?:from\s*|import\s*\(|import\s*|require\s*\()\s*["']([^"']+)["']/g;
  for (const match of code.matchAll(expression)) {
    const dependency = match[1];
    if (dependency && forbiddenBrowserImport(dependency)) {
      throw new Error("ZV3001: Browser output from " + source + " imports server-only " + dependency);
    }
  }
}
