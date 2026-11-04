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
  const attributes = /\b(?:class|className)\s*=\s*(?:(["'])([^"']*)\1|\{([^}]*)\})/gu;
  for (const match of source.matchAll(attributes)) {
    const offset = match.index;
    let literal: string | undefined;
    let start = -1;
    if (match[1]) { literal = match[2] ?? ""; start = offset + match[0].indexOf(match[1]) + 1; }
    else {
      const expr = (match[3] ?? "").trim();
      const quote = expr[0];
      if ((quote === '"' || quote === "'" || quote === "`") && expr.endsWith(quote) && !expr.includes("${")) {
        literal = expr.slice(1, -1);
        start = offset + match[0].indexOf(quote) + 1;
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
