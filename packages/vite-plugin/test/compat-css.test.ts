import { describe, expect, it } from "vitest";
import { analyzeCompatibility } from "@zaakiyjs/compat";
import { detectEmittedCssFeatures } from "../src/compat-css.js";

describe("strict build-time CSS compatibility evidence", () => {
  it("recognizes emitted selector, container, nested rule and color functions with source offsets", () => {
    const css = [
      "/* :has(.not-active) @container color-mix(in srgb, red, blue) */",
      "body:has(.modal) { color: red; }",
      "@container (min-width: 30rem) { main { color: blue; } }",
      ".item { & > span { color: blue; } }",
      ".mix { color: color-mix(in srgb, red, blue); }"
    ].join("\n");
    const found = detectEmittedCssFeatures(css, "assets/app.css");
    expect(new Set(found.map(x => x.feature))).toEqual(new Set([
      "css.selector-has", "css.container-query", "css.nesting", "css.color-mix"
    ]));
    expect(found.every(item => Number.isInteger(item.offset) && item.offset! >= 0)).toBe(true);
    expect(found.every(item => item.file === "assets/app.css")).toBe(true);
    expect(found[0]?.offset).toBeGreaterThan(0);
    expect(detectEmittedCssFeatures(css, "assets/app.css")).toEqual(found);
  });

  it("does not misinterpret CSS comments or quoted content as executable CSS syntax", () => {
    const found=detectEmittedCssFeatures(
      '/* @container :has(*) color-mix(red,blue) */ .text::before {content: ":has(*) color-mix(red,blue)"}',
      "assets/style.css"
    );
    expect(found).toEqual([]);
  });

  it("feeds semantic evidence to strict Compat for unsupported old browsers",()=>{
    const css="@container (min-width: 32rem) { .grid { display:grid } }";
    const features=detectEmittedCssFeatures(css,"assets/app.css");
    const result=analyzeCompatibility({
      mode:"strict",
      targets:{browsers:["firefox >=100"]},
      cssFeatures:features
    });
    expect(result.ok).toBe(false);
    expect(result.manifest.unsupportedFeatures).toContain("css.container-query");
    expect(result.manifest.diagnostics.some(x=>x.code==="ZK2302")).toBe(true);
  });

  it("rejects malformed CSS, excessive input and unsafe output paths",()=>{
    expect(()=>detectEmittedCssFeatures("a {","assets/app.css")).toThrow("ZV4011");
    expect(()=>detectEmittedCssFeatures("a{}".repeat(400000),"assets/app.css")).toThrow("ZV4010");
    expect(()=>detectEmittedCssFeatures("a{}","../private.css")).toThrow("ZV4010");
  });
});
