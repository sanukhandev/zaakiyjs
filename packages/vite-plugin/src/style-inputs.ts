import type { ExtractedStyleToken } from "@zaakiyjs/styles";

export interface StyleInputs {
  readonly tokens: readonly ExtractedStyleToken[];
  readonly additionalCss: readonly string[];
}

/** Avoid global CSS regeneration on JavaScript-only TSX source changes. */
export function equalStyleInputs(left: StyleInputs, right: StyleInputs): boolean {
  if (left.tokens.length !== right.tokens.length ||
      left.additionalCss.length !== right.additionalCss.length) return false;
  for (let i = 0; i < left.tokens.length; i++) {
    const a = left.tokens[i]!, b = right.tokens[i]!;
    if (a.token !== b.token || a.file !== b.file || a.offset !== b.offset) return false;
  }
  for (let i = 0; i < left.additionalCss.length; i++) {
    if (left.additionalCss[i] !== right.additionalCss[i]) return false;
  }
  return true;
}
