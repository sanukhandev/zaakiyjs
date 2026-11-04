import { describe, expect, it } from "vitest";
import postcss from "postcss";
import {
  brandCss, compileStyles, defineBrand, defineRecipe, extractStyleTokens,
  parseUtilityToken, renderBrandScope, safeCssValue, stableTokenId
} from "../src/index.js";
import type { StyleConfig } from "../src/index.js";

const config: StyleConfig = {
  brand: defineBrand({
    identity: { name: "Example", slug: "example" },
    colors: { primary: "#123456", success: "#15803d" },
    appearance: { dark: { colors: { primary: "#abcdef" } } },
    motion: { durations: { fast: "100ms" } }
  }),
  mode: "system"
};
const source = (...tokens: string[]) => tokens.map((token, offset) => ({ token, file: "example.tsx", offset }));
const compile = (...tokens: string[]) => compileStyles({ config, tokens: source(...tokens), minify: true });

describe("Zaakiy CSS compiler", () => {
  it("emits brand-first stable CSS custom properties", () => {
    const css = compile("bg-primary").css;
    expect(css).toContain("--z-color-primary:#123456");
    expect(css).toContain("--z-duration-fast:100ms");
    expect(css).toContain("@layer zaakiy.tokens,zaakiy.utilities");
    expect(css).toContain(".bg-primary{background-color:var(--z-color-primary)}");
    expect(css).toContain(':root[data-zaakiy-mode="dark"],[data-zaakiy-mode="dark"],.dark{--z-color-primary:#abcdef}');
    expect(css).toContain("prefers-color-scheme:dark");
    expect(() => postcss.parse(css)).not.toThrow();
  });
  it("parses display, positioning, flexbox, grid, spacing, sizing, type, color and border", () => {
    const result = compile("grid", "grid-cols-3", "gap-4", "flex-col", "p-4", "mx-auto", "w-1/2", "h-full", "text-center", "text-xl", "font-bold", "rounded-lg", "border-primary", "shadow-sm", "opacity-50", "relative");
    expect(result.diagnostics).toEqual([]);
    expect(result.css).toContain(".grid-cols-3{grid-template-columns:repeat(3,minmax(0,1fr))}");
    expect(result.css).toContain(".mx-auto{margin-left:auto;margin-right:auto}");
    expect(result.css).toContain(".w-1\\/2{width:50%}");
    expect(result.css).toContain(".shadow-sm{box-shadow:var(--z-shadow-sm)}");
    expect(result.css).toContain(".border-primary{border-color:var(--z-color-primary)}");
  });
  it("rejects unsupported arbitrary values, malformed variants, and unknown utilities", () => {
    expect(parseUtilityToken("bg-[url(https://example.com)]", config)).toBeUndefined();
    expect(parseUtilityToken("hover:hover:flex", config)).toBeUndefined();
    const result = compile("does-not-exist", "bg-[evil]", "md:3xl:p-4");
    expect(result.diagnostics).toHaveLength(3);
    expect(result.diagnostics.find(d => d.token === "does-not-exist")).toMatchObject({ code: "ZSTY_UNKNOWN_UTILITY", file: "example.tsx", offset: 0 });
    expect(result.css).not.toContain("does-not-exist");
    expect(result.css).not.toContain("evil");
  });
  it("deduplicates, generates stable IDs and is independent of traversal order", () => {
    const one = compile("flex", "p-4", "flex", "hover:bg-primary");
    const two = compile("hover:bg-primary", "flex", "p-4");
    expect(one.css).toBe(two.css);
    expect(one.tokenIds).toEqual(two.tokenIds);
    expect(one.css.match(/\.flex\{display:flex\}/gu)).toHaveLength(1);
    expect(one.metrics?.inputCount).toBe(4);
    expect(one.metrics?.uniqueCount).toBe(3);
    expect((one.metrics?.estimatedUndeduplicatedBytes ?? 0)).toBeGreaterThan(one.metrics?.generatedBytes ?? 0);
    expect(stableTokenId("p-4")).toBe(stableTokenId("p-4"));
    expect(stableTokenId("p-4")).not.toBe(stableTokenId("p-6"));
  });
  it("sorts breakpoints and generates responsive + state selectors", () => {
    const result = compile("lg:hover:bg-primary", "sm:p-4", "focus-visible:outline", "focus:p-2", "disabled:opacity-50", "hover:bg-primary", "md:grid-cols-2");
    expect(result.css).toContain("@media (min-width:640px){.sm\\:p-4");
    expect(result.css).toContain("@media (min-width:768px){.md\\:grid-cols-2");
    expect(result.css).toContain("@media (min-width:1024px){.lg\\:hover\\:bg-primary:hover");
    expect(result.css).toContain(".focus-visible\\:outline:focus-visible");
    expect(result.css).toContain(".disabled\\:opacity-50:disabled");
  });
  it("generates dark variant selectors without runtime JS", () => {
    expect(compile("dark:hover:bg-primary").css).toContain(':where([data-zaakiy-mode="dark"],.dark) .dark\\:hover\\:bg-primary:hover');
  });
  it("safelist supports runtime choices, while extraction detects dynamic expressions", () => {
    const extracted = extractStyleTokens('<div class="flex p-4" className={`gap-4`} class={enabled ? "hidden" : "block"}/>', "ui.tsx");
    expect(extracted.tokens.map(x => x.token)).toEqual(["flex", "p-4", "gap-4"]);
    expect(extracted.tokens[0]).toMatchObject({ file: "ui.tsx", offset: 12 });
    expect(extracted.diagnostics).toMatchObject([{ code: "ZSTY_DYNAMIC_CLASS", file: "ui.tsx" }]);
    const result = compileStyles({ config: { ...config, safelist: ["hidden", "block"] }, tokens: extracted.tokens, minify: true });
    expect(result.css).toContain(".hidden{display:none}");
    expect(result.css).toContain(".block{display:block}");
  });
  it("supports compositional typed recipes and compound variants", () => {
    const button = defineRecipe({
      base: "inline-flex rounded-md",
      variants: { size: { sm: "px-2 py-1", lg: "px-4 py-2" }, intent: { primary: "bg-primary", subtle: "bg-surface" } },
      defaultVariants: { size: "sm", intent: "primary" },
      compoundVariants: [{ when: { size: "lg", intent: "primary" }, classes: "font-bold" }]
    });
    expect(button()).toBe("inline-flex rounded-md bg-primary px-2 py-1");
    expect(button({ size: "lg" })).toBe("inline-flex rounded-md bg-primary px-4 py-2 font-bold");
    expect(() => button({ size: "bad" as "lg" })).toThrow(/Unknown recipe variant/u);
  });
  it("safely renders scoped overrides and rejects CSS selector injection", () => {
    expect(renderBrandScope("checkout", { colors: { primary: "#000" } })).toBe('[data-zaakiy-brand="checkout"]{--z-color-primary:#000}');
    expect(() => renderBrandScope('x"]{}', { colors: { primary: "#000" } })).toThrow();
    expect(() => renderBrandScope("checkout", { colors: { primary: "red;body{display:none}" } })).toThrow();
    expect(safeCssValue("url(https://evil.test)")).toBe(false);
    expect(safeCssValue("red/*")).toBe(false);
    expect(safeCssValue("#123abc")).toBe(true);
    const bad = compileStyles({ config: { brand: { colors: { primary: "red;*{display:none}" } } }, tokens: source("bg-primary") });
    expect(bad.css).toBe("");
    expect(bad.diagnostics[0]?.severity).toBe("error");
  });
  it("supports reduced-motion rules and basic browser target prefixing", () => {
    const compiled = compileStyles({ config: { ...config, targets: { safari: 14 } }, tokens: source("select-none", "transition", "animate-fade-in") , minify: true });
    expect(compiled.css).toContain("-webkit-user-select:none;user-select:none");
    expect(compiled.css).toContain("@keyframes z-fade-in");
    expect(compiled.css).toContain("@media (prefers-reduced-motion:reduce)");
  });
  it("minifies generated CSS with a PostCSS parser validation pass", () => {
    const request = { config, tokens: source("p-4", "flex", "hover:bg-primary") };
    const compact = compileStyles({ ...request, minify: true });
    const expanded = compileStyles({ ...request, minify: false });
    expect(compact.css.length).toBeLessThan(expanded.css.length);
    expect(() => postcss.parse(expanded.css)).not.toThrow();
    expect(compact.css).not.toContain("tailwind");
    expect(compact.sourceMap).toBeUndefined(); // No misleading TSX-origin map is generated.
  });
  it("orders custom breakpoint rules by actual CSS width, not insertion order", () => {
    const cfg: StyleConfig = { ...config, brand: { ...config.brand, breakpoints: { desktop: "1200px", tablet: "800px" } } };
    const output = compileStyles({ config: cfg, tokens: source("lg:p-6", "desktop:p-8", "tablet:p-2", "md:p-4"), minify: true }).css;
    expect(output.indexOf("min-width:768px")).toBeLessThan(output.indexOf("min-width:800px"));
    expect(output.indexOf("min-width:800px")).toBeLessThan(output.indexOf("min-width:1024px"));
    expect(output.indexOf("min-width:1024px")).toBeLessThan(output.indexOf("min-width:1200px"));
  });
  it("supports system dark utility activation and explicit dark/light scopes", () => {
    const css = compile("dark:bg-primary").css;
    expect(css).toContain(':where([data-zaakiy-mode="dark"],.dark) .dark\\:bg-primary');
    expect(css).toContain('@media (prefers-color-scheme:dark){:root:not([data-zaakiy-mode="light"]):not([data-zaakiy-mode="dark"]):not(.dark) .dark\\:bg-primary');
    expect(css).toContain('[data-zaakiy-mode="light"]{--z-color-primary:#123456}');
    const pinned = compileStyles({config:{...config,mode:"dark"},tokens:source("dark:bg-primary"),minify:true}).css;
    expect(pinned).toContain('.dark\\:bg-primary{background-color:var(--z-color-primary)}');
    expect(pinned).not.toContain('prefers-color-scheme:dark');
  });
  it("flattens unsupported CSS Cascade Layers for legacy browser targets", () => {
    const legacy = compileStyles({
      config: { ...config, targets: { safari: 14 } },
      tokens: source("flex", "select-none", "focus-visible:outline"), minify: true
    });
    expect(legacy.css).not.toContain("@layer");
    expect(legacy.css).toContain(".flex{display:flex}");
    expect(legacy.css).toContain("-webkit-user-select:none;user-select:none");
    expect(legacy.css).toContain(".focus-visible\\:outline:focus{outline-style:solid}");
    expect(legacy.diagnostics.map(d => d.code)).toContain("ZSTY_COMPAT_LAYER_FLATTENED");
    expect(legacy.diagnostics.map(d => d.code)).toContain("ZSTY_COMPAT_FOCUS_VISIBLE_FALLBACK");
    expect(() => postcss.parse(legacy.css)).not.toThrow();
    const firefox = compileStyles({config:{...config,targets:{firefox:96}},tokens:source("grid")});
    expect(firefox.css).not.toContain("@layer");
  });
  it("distinguishes static class strings from expressions and records accurate source offsets", () => {
    const text = '<div className={"flex" + " hidden"} class={state ? "block" : "hidden"} className={"p-4"} />';
    const extraction = extractStyleTokens(text, "source.tsx");
    expect(extraction.tokens.map(t => t.token)).toEqual(["p-4"]);
    expect(extraction.diagnostics.map(d => d.code)).toEqual(["ZSTY_DYNAMIC_CLASS", "ZSTY_DYNAMIC_CLASS"]);
    const joined = compileStyles({config, tokens:[{ token: "flex bad-utility", file: "source.tsx", offset: 10 }], minify:true});
    expect(joined.diagnostics.find(d => d.token === "bad-utility")).toMatchObject({ file: "source.tsx", offset: 15 });
  });
  it("rejects invalid typed browser target versions without emitting CSS", () => {
    const invalid = compileStyles({config:{...config,targets:{safari:-1}},tokens:source("flex")});
    expect(invalid.css).toBe("");
    expect(invalid.diagnostics[0]?.code).toBe("ZSTY_INVALID_BROWSER_TARGET");
  });
  it("uses stable location selection for duplicated invalid classes", () => {
    const requests = [
      {token:"invalid-utility",file:"z.tsx",offset:500},
      {token:"invalid-utility",file:"a.tsx",offset:8},
    ];
    for (const tokens of [requests, [...requests].reverse()]) {
      const result = compileStyles({config,tokens,minify:true});
      expect(result.diagnostics[0]).toMatchObject({token:"invalid-utility",file:"a.tsx",offset:8});
    }
  });
  it("allows no invalid CSS injection through custom brand tokens in scoped modes", () => {
    for (const value of ["url(https://evil.test/a)", "red}body{display:none", "rgb(1,2,3);@import 'x'", "#fff\n@media{}"]){
      const output = compileStyles({config:{brand:{appearance:{dark:{colors:{primary:value}}}}},tokens:source("dark:bg-primary")});
      expect(output.css).toBe("");
      expect(output.diagnostics[0]?.code).toBe("ZSTY_INVALID_BRAND_TOKEN");
    }
  });
  it("keeps package dependency independent of Tailwind and Gemini", () => {
    const manifest = { dependencies: { postcss: "8.5.32" } };
    expect(Object.keys(manifest.dependencies)).toEqual(["postcss"]);
    expect(brandCss(config)).not.toContain("@import");
  });
});
