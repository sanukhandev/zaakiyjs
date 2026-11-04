import type { ExtractedStyleToken, StyleDiagnostic } from "./types.js";
export interface ExtractionResult { readonly tokens: readonly ExtractedStyleToken[]; readonly diagnostics: readonly StyleDiagnostic[] }
/**
 * Conservative extraction helper for TSX/HTML-like literals. The authoritative TSX
 * parser lives in @zaakiyjs/compiler; it should pass ExtractedStyleToken directly.
 * This helper deliberately never evaluates interpolated expressions.
 */
export function extractStyleTokens(source: string, file: string): ExtractionResult {
  const tokens: ExtractedStyleToken[] = [];
  const diagnostics: StyleDiagnostic[] = [];
  // Avoid treating a partially captured JSX expression as a static string.
  // This is intentionally a *conservative* helper, not a TSX parser.
  const attributes = /\b(?:class|className)\s*=\s*(?:(["'])([^"']*)\1|\{([^}]*)\})/gu;
  for (const match of source.matchAll(attributes)) {
    const offset = match.index;
    let literal: string | undefined;
    let start = -1;
    if (match[1]) {
      literal = match[2] ?? "";
      start = offset + match[0].indexOf(match[1]) + 1;
    } else {
      const expression = (match[3] ?? "").trim();
      // Whitespace around the complete string literal is allowed; operators,
      // identifiers, calls and interpolated templates are always dynamic.
      const quoted = /^(?:"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'|`([^`\\]*(?:\\.[^`\\]*)*)`)$/u.exec(expression);
      if (quoted && !expression.includes("${") && !/\\/u.test(expression)) {
        literal = quoted[1] ?? quoted[2] ?? quoted[3] ?? "";
        start = offset + match[0].indexOf(expression) + 1;
      }
    }
    if (literal === undefined) {
      diagnostics.push({ code: "ZSTY_DYNAMIC_CLASS", message: "Dynamic class expression requires explicit safelist or CSS variable binding", file, offset, severity: "warning" });
      continue;
    }
    for (const result of literal.matchAll(/\S+/gu)) tokens.push({ token: result[0], file, offset: start + result.index });
  }
  return { tokens, diagnostics };
}
