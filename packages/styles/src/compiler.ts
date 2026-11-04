import postcss from "postcss";
import { brandCss, validateBrand } from "./brand.js";
import { escapeClassName, parseUtilityToken } from "./utilities.js";
import type { ExtractedStyleToken, StyleCompilerRequest, StyleCompilerResult, StyleDiagnostic } from "./types.js";

/** Stable FNV-1a over UTF-8. ID is metadata; emitted selectors use original class tokens. */
export function stableTokenId(token: string): string {
  let value = 0xcbf29ce484222325n;
  for (const b of new TextEncoder().encode(token)) {
    value = BigInt.asUintN(64, (value ^ BigInt(b)) * 0x100000001b3n);
  }
  return `z-${value.toString(16).padStart(16, "0")}`;
}
const stateOrder: Readonly<Record<string, number>> = { hover: 1, focus: 2, "focus-visible": 3, disabled: 4 };
function sortToken(a: string, b: string, config: StyleCompilerRequest["config"]): number {
  const x = parseUtilityToken(a, config);
  const y = parseUtilityToken(b, config);
  if (!x || !y) return a.localeCompare(b);
  const bpEntries = Object.entries({ sm: "640px", md: "768px", lg: "1024px", xl: "1280px", "2xl": "1536px", ...config.brand.breakpoints });
  const rank = (key?: string) => key ? bpEntries.findIndex(([name]) => name === key) + 1 : 0;
  return rank(x.breakpoint) - rank(y.breakpoint) || Number(x.dark) - Number(y.dark) || (stateOrder[x.state ?? ""] ?? 0) - (stateOrder[y.state ?? ""] ?? 0) || a.localeCompare(b);
}
/**
 * Build-time CSS compilation; input classes are never executed as JS or interpolated
 * into raw CSS declarations. PostCSS parses the assembled stylesheet and performs
 * the limited target-specific normalization documented in README.
 */
export function compileStyles(request: StyleCompilerRequest): StyleCompilerResult {
  const diagnostics: StyleDiagnostic[] = validateBrand(request.config.brand);
  const empty = { css: "", diagnostics, tokenIds: {} as Record<string, string> };
  if (diagnostics.some(d => d.severity === "error")) return empty;
  const tokenMap = new Map<string, ExtractedStyleToken>();
  for (const item of request.tokens) {
    for (const token of item.token.split(/\s+/u).filter(Boolean)) {
      if (!tokenMap.has(token)) tokenMap.set(token, { ...item, token });
    }
  }
  for (const token of request.config.safelist ?? []) {
    for (const className of token.split(/\s+/u).filter(Boolean)) {
      if (!tokenMap.has(className)) tokenMap.set(className, { token: className, file: "<safelist>", offset: 0 });
    }
  }
  const unique = [...tokenMap.keys()].sort((a, b) => sortToken(a, b, request.config));
  const rules: string[] = [];
  const compiledRuleLengths = new Map<string, number>();
  const ids: Record<string, string> = {};
  const reduced: string[] = [];
  let usedAnimation = false;
  for (const token of unique) {
    const parsed = parseUtilityToken(token, request.config);
    if (!parsed) {
      const at = tokenMap.get(token);
      diagnostics.push({ code: /\$\{|\[|\]/u.test(token) ? "ZSTY_DYNAMIC_CLASS" : "ZSTY_UNKNOWN_UTILITY", message: `Unsupported utility '${token}'. Use a static token or safelist a supported alternative.`, token, file: at?.file, offset: at?.offset, severity: "warning" });
      continue;
    }
    ids[token] = stableTokenId(token);
    const selector = `${parsed.dark ? ':where([data-zaakiy-mode="dark"],.dark) ' : ""}.${escapeClassName(token)}${parsed.state ? `:${parsed.state}` : ""}`;
    const body = parsed.declarations.map(([prop, val]) => `${prop}:${val}`).join(";");
    let rule = `${selector}{${body}}`;
    if (parsed.minWidth) rule = `@media (min-width:${parsed.minWidth}){${rule}}`;
    rules.push(rule);
    compiledRuleLengths.set(token, new TextEncoder().encode(rule).length);
    if (parsed.reduceMotion) {
      let r = `${selector}{transition-duration:.01ms!important;animation-duration:.01ms!important;animation-iteration-count:1!important}`;
      if (parsed.minWidth) r = `@media (min-width:${parsed.minWidth}){${r}}`;
      reduced.push(r);
      compiledRuleLengths.set(token, (compiledRuleLengths.get(token) ?? 0) + new TextEncoder().encode(r).length);
    }
    if (token.endsWith("animate-fade-in")) usedAnimation = true;
  }
  // No raw user values are passed as CSS selectors/declarations. Even safe values
  // receive a parser pass so malformed nested CSS cannot escape into output.
  const base = brandCss(request.config);
  const animation = usedAnimation ? "@keyframes z-fade-in{from{opacity:0}to{opacity:1}}" : "";
  const cssSource = `@layer zaakiy.tokens,zaakiy.utilities;@layer zaakiy.tokens{${base}}@layer zaakiy.utilities{${rules.join("")}${animation}}${reduced.length ? `@media (prefers-reduced-motion:reduce){${reduced.join("")}}` : ""}`;
  let css = "";
  try {
    const root = postcss.parse(cssSource, { from: undefined });
    const targets = request.config.targets;
    if (targets?.safari !== undefined && targets.safari < 15.4) {
      root.walkDecls("user-select", d => { d.cloneBefore({ prop: "-webkit-user-select" }); });
    }
    css = root.toString();
    if (!request.minify) css = css.replace(/\}(?=[^\}]|$)/gu, "}\n").replace(/;@layer/gu, ";\n@layer").trimEnd() + "\n";
  } catch (error) {
    diagnostics.push({ code: "ZSTY_CSS_PARSE", message: `CSS parsing failed: ${error instanceof Error ? error.message : String(error)}`, severity: "error" });
    return { ...empty, diagnostics };
  }
  const counts = new Map<string, number>();
  for (const source of [...request.tokens.map(t => t.token), ...(request.config.safelist ?? [])]) {
    for (const token of source.split(/\s+/u).filter(Boolean)) counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  const extraBytes = [...counts].reduce((sum, [token, count]) => sum + Math.max(0, count - 1) * (compiledRuleLengths.get(token) ?? 0), 0);
  const bytes = new TextEncoder().encode(css).length;
  return {
    css, diagnostics, tokenIds: ids,
    metrics: { inputCount: request.tokens.length + (request.config.safelist?.length ?? 0), uniqueCount: unique.length, estimatedUndeduplicatedBytes: bytes + extraBytes, generatedBytes: bytes }
  };
}
export { parseUtilityToken } from "./utilities.js";
