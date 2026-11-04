import { cssVar, resolveBrand, resolveBreakpoints, safeCssValue } from "./brand.js";
import type { StyleConfig } from "./types.js";

export interface ParsedUtility {
  readonly token: string;
  readonly declarations: readonly (readonly [string, string])[];
  readonly state?: "hover" | "focus" | "focus-visible" | "disabled";
  readonly dark: boolean;
  readonly breakpoint?: string;
  readonly minWidth?: string;
  readonly reduceMotion: boolean;
}
const states = new Set(["hover", "focus", "focus-visible", "disabled"]);
const decl = (prop: string, value: string): readonly (readonly [string, string])[] => [[prop, value]];
const staticUtilities: Readonly<Record<string, readonly (readonly [string, string])[]>> = {
  block: decl("display", "block"), "inline-block": decl("display", "inline-block"), inline: decl("display", "inline"),
  flex: decl("display", "flex"), "inline-flex": decl("display", "inline-flex"),
  grid: decl("display", "grid"), "inline-grid": decl("display", "inline-grid"), hidden: decl("display", "none"),
  contents: decl("display", "contents"), static: decl("position", "static"), relative: decl("position", "relative"),
  absolute: decl("position", "absolute"), fixed: decl("position", "fixed"), sticky: decl("position", "sticky"),
  "flex-row": decl("flex-direction", "row"), "flex-col": decl("flex-direction", "column"),
  "flex-wrap": decl("flex-wrap", "wrap"), "flex-nowrap": decl("flex-wrap", "nowrap"),
  "flex-1": decl("flex", "1 1 0%"), "flex-auto": decl("flex", "1 1 auto"),
  grow: decl("flex-grow", "1"), "grow-0": decl("flex-grow", "0"),
  shrink: decl("flex-shrink", "1"), "shrink-0": decl("flex-shrink", "0"),
  "items-start": decl("align-items", "flex-start"), "items-center": decl("align-items", "center"),
  "items-end": decl("align-items", "flex-end"), "items-stretch": decl("align-items", "stretch"),
  "justify-start": decl("justify-content", "flex-start"), "justify-center": decl("justify-content", "center"),
  "justify-end": decl("justify-content", "flex-end"), "justify-between": decl("justify-content", "space-between"),
  "justify-around": decl("justify-content", "space-around"),
  "self-center": decl("align-self", "center"), "self-start": decl("align-self", "flex-start"),
  "overflow-hidden": decl("overflow", "hidden"), "overflow-auto": decl("overflow", "auto"),
  "overflow-scroll": decl("overflow", "scroll"),
  "text-left": decl("text-align", "left"), "text-center": decl("text-align", "center"),
  "text-right": decl("text-align", "right"), "text-justify": decl("text-align", "justify"),
  "truncate": [["overflow", "hidden"], ["text-overflow", "ellipsis"], ["white-space", "nowrap"]],
  "whitespace-nowrap": decl("white-space", "nowrap"),
  "border": decl("border-width", "1px"), "border-0": decl("border-width", "0"),
  "border-2": decl("border-width", "2px"), "border-4": decl("border-width", "4px"),
  "border-solid": decl("border-style", "solid"), "border-dashed": decl("border-style", "dashed"),
  "rounded": decl("border-radius", "var(--z-radius-md)"),
  "shadow": decl("box-shadow", "var(--z-shadow-md)"),
  "opacity-0": decl("opacity", "0"), "opacity-25": decl("opacity", ".25"),
  "opacity-50": decl("opacity", ".5"), "opacity-75": decl("opacity", ".75"),
  "opacity-100": decl("opacity", "1"),
  "pointer-events-none": decl("pointer-events", "none"),
  "cursor-pointer": decl("cursor", "pointer"), "cursor-not-allowed": decl("cursor", "not-allowed"),
  "select-none": decl("user-select", "none"), "select-text": decl("user-select", "text"),
  "outline-none": decl("outline-style", "none"), "outline": decl("outline-style", "solid"),
  "transition": [["transition-property", "color, background-color, border-color, opacity, transform"], ["transition-duration", "var(--z-duration-normal)"], ["transition-timing-function", "var(--z-easing-standard)"]],
  "transition-colors": [["transition-property", "color, background-color, border-color"], ["transition-duration", "var(--z-duration-normal)"], ["transition-timing-function", "var(--z-easing-standard)"]],
  "transition-opacity": [["transition-property", "opacity"], ["transition-duration", "var(--z-duration-normal)"]],
  "animate-fade-in": decl("animation", "z-fade-in var(--z-duration-normal) var(--z-easing-standard) both")
};

const sizeProps: Readonly<Record<string, string>> = { w: "width", h: "height", "min-w": "min-width", "min-h": "min-height", "max-w": "max-width", "max-h": "max-height" };
const sizeValues: Readonly<Record<string, string>> = {
  full: "100%", auto: "auto", screen: "100vw", svw: "100svw", fit: "fit-content", min: "min-content", max: "max-content",
  "1/2": "50%", "1/3": "33.333333%", "2/3": "66.666667%", "1/4": "25%", "3/4": "75%", "0": "0px"
};
const spacingProps: Readonly<Record<string, readonly string[]>> = {
  p: ["padding"], px: ["padding-left", "padding-right"], py: ["padding-top", "padding-bottom"],
  pt: ["padding-top"], pb: ["padding-bottom"], pl: ["padding-left"], pr: ["padding-right"],
  m: ["margin"], mx: ["margin-left", "margin-right"], my: ["margin-top", "margin-bottom"],
  mt: ["margin-top"], mb: ["margin-bottom"], ml: ["margin-left"], mr: ["margin-right"],
  gap: ["gap"], "gap-x": ["column-gap"], "gap-y": ["row-gap"],
  inset: ["inset"], top: ["top"], right: ["right"], bottom: ["bottom"], left: ["left"]
};

/** CSS.escape-compatible for supported ASCII tokens, including leading numeric prefixes. */
export function escapeClassName(value: string): string {
  return [...value].map((char, index) => {
    const code = char.codePointAt(0) ?? 0;
    if ((index === 0 && code >= 48 && code <= 57) || (index === 1 && value.startsWith("-") && code >= 48 && code <= 57)) return `\\${code.toString(16)} `;
    return /[a-zA-Z0-9_-]/u.test(char) ? char : `\\${char}`;
  }).join("");
}

export function parseUtilityToken(token: string, config: StyleConfig): ParsedUtility | undefined {
  if (token.length > 160 || !/^[a-zA-Z0-9_:/.-]+$/u.test(token)) return undefined;
  const segments = token.split(":");
  const base = segments.pop();
  if (!base) return undefined;
  const variants = segments;
  const bp = resolveBreakpoints(config.brand);
  let breakpoint: string | undefined;
  let state: ParsedUtility["state"];
  let dark = false;
  for (const variant of variants) {
    if (variant === "dark" && !dark) { dark = true; continue; }
    if (states.has(variant) && !state) { state = variant as ParsedUtility["state"]; continue; }
    if (Object.prototype.hasOwnProperty.call(bp, variant) && !breakpoint) { breakpoint = variant; continue; }
    return undefined;
  }
  const brand = resolveBrand(config.brand);
  const classes = staticUtilities[base];
  let declarations = classes;
  if (!declarations) {
    const spacing = /^(gap-x|gap-y|gap|px|py|pt|pb|pl|pr|p|mx|my|mt|mb|ml|mr|m|inset|top|right|bottom|left)-([a-zA-Z0-9-]+)$/u.exec(base);
    if (spacing) {
      const prop = spacingProps[spacing[1] ?? ""];
      const key = spacing[2] ?? "";
      const value = key === "auto" && prop?.every(p => p.startsWith("margin")) ? "auto" : Object.prototype.hasOwnProperty.call(brand.spacing, key) ? cssVar("spacing", key) : undefined;
      if (prop && value) declarations = prop.map(p => [p, value] as const);
    }
  }
  if (!declarations) {
    const size = /^(min-w|min-h|max-w|max-h|w|h)-([a-zA-Z0-9/-]+)$/u.exec(base);
    if (size) {
      const prop = sizeProps[size[1] ?? ""];
      const key = size[2] ?? "";
      const value = sizeValues[key] ?? (Object.prototype.hasOwnProperty.call(brand.spacing, key) ? cssVar("spacing", key) : undefined);
      if (prop && value) declarations = decl(prop, key === "screen" && (prop === "height" || prop === "min-height" || prop === "max-height") ? "100vh" : value);
    }
  }
  if (!declarations) {
    const grid = /^(grid-cols|grid-rows|col-span|row-span)-(\d+)$/u.exec(base);
    if (grid) {
      const number = Number(grid[2]);
      if (number >= 1 && number <= 12) {
        const property = grid[1];
        if (property === "grid-cols") declarations = decl("grid-template-columns", `repeat(${number},minmax(0,1fr))`);
        if (property === "grid-rows") declarations = decl("grid-template-rows", `repeat(${number},minmax(0,1fr))`);
        if (property === "col-span") declarations = decl("grid-column", `span ${number}/span ${number}`);
        if (property === "row-span") declarations = decl("grid-row", `span ${number}/span ${number}`);
      }
    }
  }
  if (!declarations) {
    const mapped: readonly [string, string][] = [
      ["rounded-", "radii"], ["shadow-", "shadows"], ["bg-", "colors"], ["border-", "colors"],
      ["font-", "fonts"], ["text-", "fontSizes"], ["text-", "colors"], ["font-", "fontWeights"],
      ["leading-", "lineHeights"], ["tracking-", "letterSpacing"], ["duration-", "durations"], ["ease-", "easings"]
    ];
    for (const [prefix, group] of mapped) {
      if (!base.startsWith(prefix)) continue;
      const key = base.slice(prefix.length);
      const values = brand[group as keyof typeof brand];
      if (!Object.prototype.hasOwnProperty.call(values, key)) continue;
      const property: Record<string, string> = {
        radii: "border-radius", shadows: "box-shadow", colors: prefix === "bg-" ? "background-color" : prefix === "border-" ? "border-color" : "color",
        fonts: "font-family", fontSizes: "font-size", fontWeights: "font-weight", lineHeights: "line-height",
        letterSpacing: "letter-spacing", durations: "transition-duration", easings: "transition-timing-function"
      };
      const name = property[group];
      if (name) declarations = decl(name, cssVar(group as Parameters<typeof cssVar>[0], key));
      break;
    }
  }
  if (!declarations) return undefined;
  if (declarations.some(([,value]) => !safeCssValue(value))) return undefined;
  const minWidth = breakpoint ? bp[breakpoint] : undefined;
  return { token, declarations, state, dark, breakpoint, minWidth, reduceMotion: base.startsWith("transition") || base.startsWith("duration-") || base.startsWith("animate-") };
}
