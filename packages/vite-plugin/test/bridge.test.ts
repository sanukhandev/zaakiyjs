import { describe, expect, it } from "vitest";
import type { CompileResult } from "@zaakiyjs/compiler";
import {
  assertBrowserOutput,
  assertStyleConfig,
  forbiddenBrowserImport,
  formatDiagnostic,
  hasCompiler,
  hasStyles,
  hasStyleTokenExtractor,
  invokeCompiler,
  invokeStyles,
  styleTokensFromResult
} from "../src/bridge.js";
import { zaakiyPlugin } from "../src/index.js";

const emptyResult: CompileResult = {
  irVersion: 1,
  js: [{ fileName: "fixture.js", code: "export const value = 1;", map: '{"version":3,"sources":["fixture.tsx"],"names":[],"mappings":""}' }],
  css: [],
  diagnostics: []
};

describe("M0 Vite/compiler/styles contract bridge", () => {
  it("exports a real Vite plugin factory without declaring full integration complete", () => {
    const plugin = zaakiyPlugin();
    expect(plugin.name).toBe("zaakiy:compiler");
    expect(plugin.enforce).toBe("pre");
  });

  it("rejects incompatible virtual CSS IDs and unsafe CSS output paths", () => {
    expect(() => zaakiyPlugin({ cssVirtualId: "virtual:custom.css" })).toThrow("ZV0001");
    expect(() => zaakiyPlugin({ cssFileName: "../secret.css" })).toThrow("ZV0002");
    expect(() => zaakiyPlugin({ cssFileName: "assets/../../secret.css" })).toThrow("ZV0002");
    expect(() => zaakiyPlugin({ cssFileName: "https://host/styles.css" })).toThrow("ZV0002");
    expect(zaakiyPlugin({ cssFileName: "assets/theme/brand.css" }).name).toBe("zaakiy:compiler");
  });

  it("accepts typed brand tokens and rejects malformed brand data", () => {
    expect(assertStyleConfig({ brand: { colors: { primary: "#fff" } } }, "brand.ts")).toEqual({
      brand: { colors: { primary: "#fff" } }
    });
    expect(() => assertStyleConfig({ brand: "invalid" }, "brand.ts")).toThrow("ZV2006");
    expect(() => assertStyleConfig({ brand: { colors: { primary: 22 } } }, "brand.ts")).toThrow("ZV2007");
    expect(() => assertStyleConfig({ brand: {}, safelist: [2] }, "brand.ts")).toThrow("ZV2009");
  });

  it("reads versioned style token metadata without pretending the compiler implemented extraction", () => {
    expect(styleTokensFromResult(emptyResult, "fixture.tsx")).toEqual([]);
    const source = '<div class="flex gap-4" />';
    const compilerResult: CompileResult = {
      ...emptyResult,
      manifest: { styleTokens: ["flex", "gap-4"] }
    };
    if (hasStyleTokenExtractor()) {
      expect(styleTokensFromResult(compilerResult, "fixture.tsx", source)).toEqual([
        { token: "flex", file: "fixture.tsx", offset: source.indexOf("flex") },
        { token: "gap-4", file: "fixture.tsx", offset: source.indexOf("gap-4") }
      ]);
      expect(() => styleTokensFromResult({
        ...emptyResult, manifest: { styleTokens: ["not-present"] }
      }, "fixture.tsx", source)).toThrow("ZV2013");
    } else {
      // No fake offsets are permitted while the M0 styles package is types-only.
      expect(() => styleTokensFromResult(compilerResult, "fixture.tsx", source))
        .toThrow("ZV2011");
    }
    expect(styleTokensFromResult({
      ...emptyResult,
      manifest: { styleTokens: [{ token: "flex", file: "fixture.tsx", offset: 42 }] }
    }, "fixture.tsx")).toEqual([{ token: "flex", file: "fixture.tsx", offset: 42 }]);
    expect(() => styleTokensFromResult({
      ...emptyResult,
      manifest: { styleTokens: [{ token: "flex", offset: -1 }] }
    }, "fixture.tsx")).toThrow("ZV2005");
    expect(() => styleTokensFromResult({
      ...emptyResult,
      manifest: { styleTokens: [{ token: "flex", file: "fixture.tsx", offset: 0 }] }
    }, "fixture.tsx", source)).toThrow("ZV2014");
  });

  it("forwards source diagnostics with 1-based compiler spans to zero-based Rollup columns", () => {
    expect(formatDiagnostic({
      code: "ZC100", severity: "error", message: "Bad TSX",
      span: {
        file: "src/App.tsx",
        start: { line: 3, column: 7, offset: 24 },
        end: { line: 3, column: 9, offset: 26 }
      }
    }, "fallback.tsx")).toEqual({
      message: "[ZC100] Bad TSX",
      id: "src/App.tsx",
      loc: { file: "src/App.tsx", line: 3, column: 6 }
    });
  });

  it("blocks build-time and AI imports from browser output", () => {
    for (const specifier of [
      "@zaakiyjs/ai", "@zaakiyjs/proxy/router", "@zaakiyjs/compiler",
      "@zaakiyjs/styles", "@zaakiyjs/vite-plugin"
    ]) {
      expect(forbiddenBrowserImport(specifier)).toBe(true);
      expect(() => assertBrowserOutput('import x from "' + specifier + '";', "view.tsx")).toThrow("ZV3001");
    }
    expect(forbiddenBrowserImport("@zaakiyjs/dom/compiler")).toBe(false);
    expect(() => assertBrowserOutput('import { mount } from "@zaakiyjs/dom";', "view.tsx")).not.toThrow();
  });

  it("fails closed when M0 packages have no implementation, without using a mock compiler", async () => {
    if (!hasCompiler()) {
      await expect(invokeCompiler({ fileName: "fixture.tsx", source: "<main />" })).rejects.toThrow("ZV1001");
    }
    if (!hasStyles()) {
      await expect(invokeStyles({ tokens: [], config: { brand: {} } })).rejects.toThrow("ZV2001");
    }
  });
});
