import type { BrandMotion, BrandOverride, BrandTokens, BrandTypography, StyleConfig, StyleDiagnostic } from "./types.js";

const defaults = {
  colors: { primary: "#2563eb", secondary: "#475569", background: "#ffffff", foreground: "#0f172a", surface: "#f8fafc", muted: "#64748b", success: "#15803d", warning: "#a16207", danger: "#b91c1c", border: "#cbd5e1", transparent: "transparent" },
  spacing: { "0": "0px", px: "1px", "1": "0.25rem", "2": "0.5rem", "3": "0.75rem", "4": "1rem", "5": "1.25rem", "6": "1.5rem", "8": "2rem", "10": "2.5rem", "12": "3rem", "16": "4rem" },
  fonts: { sans: "ui-sans-serif, system-ui, sans-serif", mono: "ui-monospace, monospace" },
  radii: { none: "0px", sm: "0.125rem", md: "0.375rem", lg: "0.5rem", xl: "0.75rem", full: "9999px" },
  shadows: { sm: "0 1px 2px rgb(0 0 0 / 0.08)", md: "0 4px 6px rgb(0 0 0 / 0.12)", lg: "0 10px 15px rgb(0 0 0 / 0.14)" },
  breakpoints: { sm: "640px", md: "768px", lg: "1024px", xl: "1280px", "2xl": "1536px" },
  typography: {
    fontSizes: { xs: "0.75rem", sm: "0.875rem", base: "1rem", lg: "1.125rem", xl: "1.25rem", "2xl": "1.5rem", "3xl": "1.875rem" },
    fontWeights: { normal: "400", medium: "500", semibold: "600", bold: "700" },
    lineHeights: { none: "1", tight: "1.25", normal: "1.5", relaxed: "1.75" },
    letterSpacing: { tight: "-0.025em", normal: "0em", wide: "0.025em" }
  },
  motion: { durations: { fast: "120ms", normal: "200ms", slow: "350ms" }, easings: { standard: "ease", in: "ease-in", out: "ease-out", "in-out": "ease-in-out" } }
} as const;

export type TokenGroup = "colors" | "spacing" | "fonts" | "radii" | "shadows" | "fontSizes" | "fontWeights" | "lineHeights" | "letterSpacing" | "durations" | "easings";
export const defaultBreakpoints: Readonly<Record<string, string>> = defaults.breakpoints;
const nameRx = /^[a-zA-Z0-9][a-zA-Z0-9-]*$/;
const bannedCss = /[;{}<>\\]|\/\*|\*\/|@import|(?:url|expression|behavior|image-set|-moz-binding)\s*\(/i;

/** Values are declarations, never selectors or raw rules. Reject CSS breakout and external fetches. */
export function safeCssValue(value: string): boolean {
  if (typeof value !== "string" || !value.trim() || value.length > 512 || bannedCss.test(value) || /[\u0000-\u001f]/.test(value)) return false;
  let depth = 0;
  for (const char of value) { if (char === "(") depth++; if (char === ")" && --depth < 0) return false; }
  if ((value.match(/"/gu)?.length ?? 0) % 2 || (value.match(/'/gu)?.length ?? 0) % 2) return false;
  return depth === 0;
}
export function safeTokenName(name: string): boolean { return nameRx.test(name) && name.length < 72; }
export function defineBrand<T extends BrandTokens>(brand: T): T { return brand; }
export function defineStyleConfig<T extends StyleConfig>(config: T): T { return config; }

function flatten(data: BrandOverride): Record<TokenGroup, Record<string, string>> {
  const t: BrandTypography = data.typography ?? {};
  const m: BrandMotion = data.motion ?? {};
  return {
    colors: { ...data.colors }, spacing: { ...data.spacing }, fonts: { ...data.fonts },
    radii: { ...data.radii }, shadows: { ...data.shadows },
    fontSizes: { ...t.fontSizes }, fontWeights: { ...t.fontWeights },
    lineHeights: { ...t.lineHeights }, letterSpacing: { ...t.letterSpacing },
    durations: { ...m.durations }, easings: { ...m.easings }
  };
}
const tokenNames: Record<TokenGroup, string> = {
  colors: "color", spacing: "space", fonts: "font", radii: "radius", shadows: "shadow",
  fontSizes: "font-size", fontWeights: "font-weight", lineHeights: "line-height", letterSpacing: "tracking",
  durations: "duration", easings: "easing"
};
export function cssVar(group: TokenGroup, key: string): string { return `var(--z-${tokenNames[group]}-${key})`; }

export function resolveBrand(brand: BrandTokens): Record<TokenGroup, Record<string, string>> {
  const base = flatten(defaults);
  const custom = flatten(brand);
  for (const group of Object.keys(base) as TokenGroup[]) Object.assign(base[group], custom[group]);
  if (brand.appearance?.light) {
    const light = flatten(brand.appearance.light);
    for (const group of Object.keys(base) as TokenGroup[]) Object.assign(base[group], light[group]);
  }
  return base;
}
export function resolveBreakpoints(brand: BrandTokens): Record<string, string> {
  return { ...defaultBreakpoints, ...brand.breakpoints };
}
export function validateBrand(brand: BrandTokens): StyleDiagnostic[] {
  const diagnostics: StyleDiagnostic[] = [];
  const validate = (part: BrandOverride, prefix: string) => {
    const map = flatten(part);
    for (const group of Object.keys(map) as TokenGroup[]) {
      for (const [name, value] of Object.entries(map[group])) {
        if (!safeTokenName(name) || !safeCssValue(value)) diagnostics.push({ code: "ZSTY_INVALID_BRAND_TOKEN", message: `Invalid ${prefix}${group}.${name} CSS token`, severity: "error" });
      }
    }
  };
  validate(brand, "brand.");
  if (brand.appearance?.light) validate(brand.appearance.light, "appearance.light.");
  if (brand.appearance?.dark) validate(brand.appearance.dark, "appearance.dark.");
  for (const [name, value] of Object.entries(brand.breakpoints ?? {})) {
    if (!safeTokenName(name) || !/^\d+(?:\.\d+)?(?:px|rem|em)$/.test(value)) diagnostics.push({ code: "ZSTY_INVALID_BREAKPOINT", message: `Invalid breakpoint ${name}`, severity: "error" });
  }
  return diagnostics;
}
export function declarationsForTokens(tokens: BrandOverride, includeDefaults = false): string[] {
  const map = includeDefaults ? resolveBrand(tokens) : flatten(tokens);
  const output: string[] = [];
  for (const group of (Object.keys(tokenNames) as TokenGroup[]).sort()) {
    for (const [key, val] of Object.entries(map[group]).sort(([a], [b]) => a.localeCompare(b))) {
      if (safeTokenName(key) && safeCssValue(val)) output.push(`--z-${tokenNames[group]}-${key}:${val}`);
    }
  }
  return output;
}
/** Escape selectors by restricting scope names. No untrusted CSS selector is accepted. */
export function renderBrandScope(scope: string, tokens: BrandOverride): string {
  if (!safeTokenName(scope)) throw new Error(`Invalid Zaakiy brand scope: ${scope}`);
  const violations = validateBrand(tokens);
  if (violations.length) throw new Error(violations.map(x => x.message).join("; "));
  const parts = declarationsForTokens(tokens);
  return parts.length ? `[data-zaakiy-brand="${scope}"]{${parts.join(";")}}` : "";
}
export function brandCss(config: StyleConfig): string {
  const brand = config.brand;
  const root = `:root{${declarationsForTokens(brand, true).join(";")}}`;
  const dark = brand.appearance?.dark;
  if (!dark) return root;
  const decl = declarationsForTokens(dark).join(";");
  if (!decl) return root;
  if (config.mode === "dark") return `${root}:root{${decl}}`;
  if (config.mode === "light") return root;
  return `${root}:root[data-zaakiy-mode="dark"]{${decl}}@media (prefers-color-scheme:dark){:root:not([data-zaakiy-mode="light"]):not([data-zaakiy-mode="dark"]){${decl}}}`;
}
