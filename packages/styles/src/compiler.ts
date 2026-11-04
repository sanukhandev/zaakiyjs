import postcss from "postcss";
import { brandCss, resolveBreakpoints, validateBrand } from "./brand.js";
import { escapeClassName, parseUtilityToken } from "./utilities.js";
import type { ParsedUtility } from "./utilities.js";
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
/** rem/em sorting uses the conventional 16px initial font size only for order. */
function breakpointPixelRank(value: string): number {
  const match = /^(\d+(?:\.\d+)?)(px|rem|em)$/u.exec(value);
  return match ? Number(match[1]) * (match[2] === "px" ? 1 : 16) : Number.POSITIVE_INFINITY;
}
function sortToken(a: string, b: string, parsed: ReadonlyMap<string, ParsedUtility | undefined>, breakpoints: Readonly<Record<string, string>>): number {
  const x = parsed.get(a);
  const y = parsed.get(b);
  if (!x || !y) return a.localeCompare(b);
  const rank = (key?: string) => key ? breakpointPixelRank(breakpoints[key] ?? "") : -1;
  return rank(x.breakpoint) - rank(y.breakpoint) || Number(x.dark) - Number(y.dark) ||
    (stateOrder[x.state ?? ""] ?? 0) - (stateOrder[y.state ?? ""] ?? 0) || a.localeCompare(b);
}
/** CSS Cascade Layers are unavailable before Safari 15.4, Firefox 97 and Chrome 99. */
function supportsCascadeLayers(request: StyleCompilerRequest): boolean {
  const t = request.config.targets;
  return !(t && ((t.safari !== undefined && t.safari < 15.4) ||
    (t.firefox !== undefined && t.firefox < 97) ||
    (t.chrome !== undefined && t.chrome < 99)));
}
function isLegacyFocusVisible(request: StyleCompilerRequest): boolean {
  const t = request.config.targets;
  return !!(t && ((t.safari !== undefined && t.safari < 15.4) ||
    (t.firefox !== undefined && t.firefox < 85) ||
    (t.chrome !== undefined && t.chrome < 86)));
}
function cssSelectors(token: string, state: string | undefined, dark: boolean, mode: string, legacyFocus: boolean): string[] {
  const stateSelector = state === "focus-visible" && legacyFocus ? ":focus" : state ? `:${state}` : "";
  const base = `.${escapeClassName(token)}${stateSelector}`;
  if (!dark || mode === "dark") return [base];
  return [`:where([data-zaakiy-mode="dark"],.dark) ${base}`];
}
function withinBreakpoint(rule: string, minWidth?: string): string {
  return minWidth ? `@media (min-width:${minWidth}){${rule}}` : rule;
}
function renderDeclarations(declarations: readonly (readonly [string, string])[], needsStickyPrefix: boolean): string {
  return declarations.flatMap(([prop, value]) => needsStickyPrefix && prop === "position" && value === "sticky"
    ? ["position:-webkit-sticky", "position:sticky"] : [`${prop}:${value}`]).join(";");
}
/**
 * Build-time CSS compilation; input classes are never executed as JS or interpolated
 * into raw CSS declarations. PostCSS parses the assembled stylesheet and performs
 * the limited target-specific normalization documented in README.
 */
export function compileStyles(request: StyleCompilerRequest): StyleCompilerResult {
  const diagnostics: StyleDiagnostic[] = validateBrand(request.config.brand);
  for (const [name, version] of Object.entries(request.config.targets ?? {})) {
    if (!["chrome", "firefox", "safari"].includes(name) || typeof version !== "number" ||
        !Number.isFinite(version) || version <= 0 || version > 300) {
      diagnostics.push({ code: "ZSTY_INVALID_BROWSER_TARGET", message: `Invalid browser target ${name}=${version}`, severity: "error" });
    }
  }
  const empty = { css: "", diagnostics, tokenIds: {} as Record<string, string> };
  if (diagnostics.some(d => d.severity === "error")) return empty;
  const tokenMap = new Map<string, ExtractedStyleToken>();
  for (const item of request.tokens) {
    for (const match of item.token.matchAll(/\S+/gu)) {
      const token = match[0];
      const occurrence = { ...item, token, offset: item.offset + match.index };
      const old = tokenMap.get(token);
      if (!old || occurrence.file < old.file || (occurrence.file === old.file && occurrence.offset < old.offset))
        tokenMap.set(token, occurrence);
    }
  }
  for (const token of request.config.safelist ?? []) {
    for (const className of token.split(/\s+/u).filter(Boolean)) {
      if (!tokenMap.has(className)) tokenMap.set(className, { token: className, file: "<safelist>", offset: 0 });
    }
  }
  // Parse once per unique class: sorting must not repeat brand resolution on
  // every comparator call for large production class inventories.
  const parsedTokens = new Map<string, ParsedUtility | undefined>();
  for (const token of tokenMap.keys()) parsedTokens.set(token, parseUtilityToken(token, request.config));
  const breakpoints = resolveBreakpoints(request.config.brand);
  const unique = [...tokenMap.keys()].sort((a, b) => sortToken(a, b, parsedTokens, breakpoints));
  const legacyFocus = isLegacyFocusVisible(request);
  const layersSupported = supportsCascadeLayers(request);
  const needsStickyPrefix = (request.config.targets?.safari ?? 99) < 13;
  if (!layersSupported) diagnostics.push({ code: "ZSTY_COMPAT_LAYER_FLATTENED", message: "Target browsers do not all support CSS Cascade Layers; generated standalone layers were flattened", severity: "warning" });
  const rules: string[] = [];
  const compiledRuleLengths = new Map<string, number>();
  const ids: Record<string, string> = {};
  const reduced: string[] = [];
  let usedAnimation = false;
  for (const token of unique) {
    const parsed = parsedTokens.get(token);
    if (!parsed) {
      const at = tokenMap.get(token);
      diagnostics.push({ code: /\$\{|\[|\]/u.test(token) ? "ZSTY_DYNAMIC_CLASS" : "ZSTY_UNKNOWN_UTILITY", message: `Unsupported utility '${token}'. Use a static token or safelist a supported alternative.`, token, file: at?.file, offset: at?.offset, severity: "warning" });
      continue;
    }
    ids[token] = stableTokenId(token);
    if (parsed.state === "focus-visible" && legacyFocus) {
      diagnostics.push({ code: "ZSTY_COMPAT_FOCUS_VISIBLE_FALLBACK", message: `Target lacks :focus-visible; '${token}' uses :focus as a keyboard-visible fallback`, token, file: tokenMap.get(token)?.file, offset: tokenMap.get(token)?.offset, severity: "warning" });
    }
    const selectors = cssSelectors(token, parsed.state, parsed.dark, request.config.mode ?? "system", legacyFocus);
    const body = renderDeclarations(parsed.declarations, needsStickyPrefix);
    const rule = withinBreakpoint(`${selectors.join(",")}{${body}}`, parsed.minWidth);
    rules.push(rule);
    compiledRuleLengths.set(token, new TextEncoder().encode(rule).length);
    // In system mode, dark: classes must also activate for the OS preference,
    // without requiring a browser-side script to toggle .dark.
    if (parsed.dark && (request.config.mode ?? "system") === "system") {
      const mediaRule = `@media (prefers-color-scheme:dark){:root:not([data-zaakiy-mode="light"]):not([data-zaakiy-mode="dark"]):not(.dark) .${escapeClassName(token)}${parsed.state === "focus-visible" && legacyFocus ? ":focus" : parsed.state ? `:${parsed.state}` : ""}{${body}}}`;
      const optionalResponsive = withinBreakpoint(mediaRule, parsed.minWidth);
      rules.push(optionalResponsive);
      compiledRuleLengths.set(token, (compiledRuleLengths.get(token) ?? 0) + new TextEncoder().encode(optionalResponsive).length);
    }
    if (parsed.reduceMotion) {
      const override = `${selectors.join(",")}{transition-duration:.01ms!important;animation-duration:.01ms!important;animation-iteration-count:1!important}`;
      const r = withinBreakpoint(override, parsed.minWidth);
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
    if (!layersSupported) {
      // Standalone Zaakiy layers have a known order and no !important inversions.
      // Unwrapping avoids silently dropping ALL utilities in Safari 14/FF 96/etc.
      root.walkAtRules("layer", atRule => {
        if (atRule.nodes) atRule.replaceWith(...atRule.nodes);
        else atRule.remove();
      });
    }
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
    for (const token of source.match(/\S+/gu) ?? []) counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  const extraBytes = [...counts].reduce((sum, [token, count]) => sum + Math.max(0, count - 1) * (compiledRuleLengths.get(token) ?? 0), 0);
  const bytes = new TextEncoder().encode(css).length;
  return {
    css, diagnostics, tokenIds: ids,
    metrics: { inputCount: [...counts.values()].reduce((sum, count) => sum + count, 0), uniqueCount: unique.length, estimatedUndeduplicatedBytes: bytes + extraBytes, generatedBytes: bytes }
  };
}
export { parseUtilityToken } from "./utilities.js";
