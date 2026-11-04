import { describe, expect, it, vi } from "vitest";
import {
  analyzeCompatibility, compareVersions, detectIRFeatures, detectSourceFeatures,
  getFeature, listFeatures, parseMode, resolveTargets, serializeManifest, toStylesTargets,
  transformEmittedJavaScript, validateManifest
} from "../src/index.js";

const modern = { profile: "modern-2024" as const };
const oldFirefox = { browsers: ["firefox >=100"] };
const source = (text: string) => [{ fileName: "src/app.ts", source: text }];

describe("mode and target contracts", () => {
  it("defaults to off and rejects unrecognized modes", () => {
    expect(parseMode(undefined)).toBe("off");
    expect(parseMode("auto")).toBe("auto");
    expect(parseMode("strict")).toBe("strict");
    expect(() => parseMode("zone")).toThrow();
  });
  it("normalizes target order and explicit versions/ranges reproducibly", () => {
    expect(resolveTargets({ browsers: ["safari 16.4..17.4", "chrome >=124"] }, "strict")).toEqual([
      { browser: "chrome", minimum: "124" }, { browser: "safari", minimum: "16.4", maximum: "17.4" }
    ]);
    expect(resolveTargets(modern, "auto").length).toBe(4);
    expect(resolveTargets({ browsers: ["chrome 124"] }, "strict")[0]).toEqual({ browser: "chrome", minimum: "124", maximum: "124" });
    expect(compareVersions("15.4", "15.3")).toBe(1);
    expect(compareVersions("16.0", "16")).toBe(0);
  });
  it.each([
    ["chrome latest"], ["ie >=11"], ["firefox >=0"], ["safari >=999"],
    ["chrome >=124, firefox >=124"], ["chrome 150..140"], ["chrome 090"],
    ["chrome >=124 and later"]
  ])("rejects unsupported or ambiguous declaration %s", target => {
    expect(() => resolveTargets({ browsers: [target] }, "auto")).toThrow();
  });
  it("rejects missing targets in enabled modes and duplicates", () => {
    expect(() => resolveTargets(undefined, "auto")).toThrow();
    expect(() => resolveTargets(undefined, "strict")).toThrow();
    expect(() => resolveTargets({ browsers: ["chrome 100", "chrome 101"] }, "auto")).toThrow();
    expect(() => resolveTargets({ profile: "modern-2024", browsers: ["chrome 100"] }, "auto")).toThrow();
  });
  it("can turn off analysis without claiming cross-browser support", () => {
    const r = analyzeCompatibility({ sources: source("const x = user?.name;") });
    expect(r.ok).toBe(true);
    expect(r.manifest.transforms).toEqual([]);
    expect(r.manifest.shims).toEqual([]);
    expect(r.manifest.detectedFeatures[0]?.status).toBe("ignored");
    expect(r.manifest.diagnostics.some(d => d.code === "ZK0001")).toBe(true);
  });
});

describe("syntax/API/IR/CSS detection and planning", () => {
  it("detects optional chaining, nullish and dynamic syntax from TypeScript AST", () => {
    const found = detectSourceFeatures({ fileName: "app.tsx", source: 'const x = user?.name ?? "guest";' });
    expect(found.requirements.map(x => x.id)).toEqual(expect.arrayContaining([
      "js.optional-chaining", "js.nullish-coalescing"
    ]));
  });
  it("recognizes a native supported browser feature", () => {
    const r = analyzeCompatibility({
      mode: "strict", targets: modern,
      sources: source("const controller = new AbortController();")
    });
    expect(r.ok).toBe(true);
    expect(r.manifest.detectedFeatures.find(x => x.id === "web.abort-controller")?.status).toBe("native");
  });
  it("selects one approved syntax transformer for multiple requirements", () => {
    const r = analyzeCompatibility({
      mode: "strict", targets: { browsers: ["safari >=13.1"] },
      sources: source("let x = true; x &&= false; x ||= true;")
    });
    expect(r.ok).toBe(true);
    expect(r.manifest.transforms).toHaveLength(1);
    expect(r.manifest.transforms[0]?.id).toBe("typescript-5.9.3-es2019");
    expect(r.manifest.detectedFeatures.find(x => x.id === "js.logical-assignment")?.status).toBe("transform");
    const js = transformEmittedJavaScript({ fileName: "app.js", code: "let x = true; x &&= false;", manifest: r.manifest });
    expect(js).not.toContain("&&=");
    expect(() => transformEmittedJavaScript({ fileName: "app.tsx", code: "const x = <div/>", manifest: r.manifest })).toThrow();
  });
  it("fails closed for unapproved native AbortSignal.any use on an older target", () => {
    const request = { targets: oldFirefox, sources: source("const s = AbortSignal.any([a, b]);") };
    const auto = analyzeCompatibility({ ...request, mode: "auto" });
    const strict = analyzeCompatibility({ ...request, mode: "strict" });
    expect(auto.ok).toBe(true);
    expect(auto.manifest.unsupportedFeatures).toContain("web.abort-signal-any");
    expect(auto.manifest.diagnostics.some(d => d.severity === "warning")).toBe(true);
    expect(strict.ok).toBe(false);
    expect(strict.manifest.diagnostics.some(d => d.code === "ZK2302" && d.severity === "error")).toBe(true);
    expect(strict.manifest.shims).toEqual([]);
  });
  it("selects scoped ponyfill ONLY when imported and explicitly invoked", () => {
    const r = analyzeCompatibility({
      mode: "strict", targets: oldFirefox, sources: source(
        'import { composeAbortSignals } from "@zaakiyjs/compat/abort"; const s = composeAbortSignals([a, b]);'
      )
    });
    expect(r.ok).toBe(true);
    expect(r.manifest.detectedFeatures.find(x => x.id === "web.abort-signal-any")?.status).toBe("ponyfill");
    expect(r.manifest.shims).toEqual([expect.objectContaining({
      id: "abort-any", module: "@zaakiyjs/compat/abort"
    })]);
  });
  it("deduplicates scoped helper inclusion for repeated imports and calls", () => {
    const r = analyzeCompatibility({
      mode: "strict", targets: oldFirefox, sources: source(
        'import { composeAbortSignals } from "@zaakiyjs/compat/abort";' +
        'const first = composeAbortSignals([a]); const second = composeAbortSignals([b]);'
      )
    });
    expect(r.ok).toBe(true);
    expect(r.manifest.shims.filter(item => item.id === "abort-any")).toHaveLength(1);
    expect(r.manifest.detectedFeatures.find(item => item.id === "web.abort-signal-any")?.requiredBy).toHaveLength(2);
  });
  it("treats direct and scoped AbortSignal API calls separately", () => {
    const r = analyzeCompatibility({
      mode: "strict", targets: oldFirefox, sources: source(
        'import { composeAbortSignals } from "@zaakiyjs/compat/abort"; composeAbortSignals([a]); AbortSignal.any([b]);'
      )
    });
    expect(r.ok).toBe(false);
    expect(r.manifest.unsupportedFeatures).toContain("web.abort-signal-any");
  });
  it("does not falsely reject native AbortSignal.timeout in Chrome 110", () => {
    const result = analyzeCompatibility({
      mode: "strict", targets: { browsers: ["chrome >=110"] },
      sources: source("const s = AbortSignal.timeout(20);")
    });
    expect(result.ok).toBe(true);
    expect(result.manifest.detectedFeatures.find(f => f.id === "web.abort-signal-timeout")?.status).toBe("native");
    expect(result.manifest.shims).toEqual([]);
  });
  it("fails strict CSS analysis when Styles cannot encode an Edge target", () => {
    const result = analyzeCompatibility({
      mode: "strict", targets: { browsers: ["edge >=124"] },
      cssFeatures: [{ feature: "css.nesting", file: "app.css" }]
    });
    expect(result.ok).toBe(false);
    expect(result.manifest.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "ZK2501", severity: "error" })
    ]));
  });
  it("detects timeout, abort reasons, fetch and structuredClone", () => {
    const r = detectSourceFeatures({ fileName: "app.ts", source:
      "const abortSignal = AbortSignal.timeout(20); abortSignal.reason; fetch('/api'); structuredClone({x: 1});" });
    expect(r.requirements.map(x => x.id)).toEqual(expect.arrayContaining([
      "web.abort-signal-timeout", "web.abort-reason", "web.fetch", "web.structured-clone"
    ]));
  });
  it("detects unknown/dynamic access without inventing native compatibility", () => {
    const r = analyzeCompatibility({ mode: "strict", targets: modern,
      sources: source("const x = AbortSignal[key];") });
    expect(r.ok).toBe(false);
    expect(r.manifest.diagnostics.some(d => d.code === "ZK2102")).toBe(true);
  });
  it("records unknown feature in IR and rejects unsupported IR versions", () => {
    const ir = { irVersion: 1, sourceFile: "file.tsx", nodes: [{
      kind: "StaticElement", children: [{ kind: "CompatFeature", feature: "web.experimental-x",
        span: { file: "file.tsx", start: { line: 3, column: 1, offset: 40 } } }]
    }] };
    expect(detectIRFeatures(ir).requirements[0]?.id).toBe("web.experimental-x");
    const r = analyzeCompatibility({ mode: "strict", targets: modern, ir: [ir] });
    expect(r.ok).toBe(false);
    expect(r.manifest.unsupportedFeatures).toEqual(["web.experimental-x"]);
    expect(analyzeCompatibility({ mode: "auto", targets: modern, ir: [{ ...ir, irVersion: 2 }] }).ok).toBe(false);
  });
  it("consumes CSS evidence from Styles contract and warns for Edge adapter gap", () => {
    const r = analyzeCompatibility({
      mode: "strict", targets: { browsers: ["edge >=100", "safari >=15.4"] },
      cssFeatures: [{ feature: "css.container-query", file: "theme.css", offset: 12 }]
    });
    expect(r.ok).toBe(false);
    expect(r.manifest.unsupportedFeatures).toContain("css.container-query");
    expect(r.manifest.diagnostics.some(d => d.code === "ZK2501")).toBe(true);
    const adapted = toStylesTargets(r.manifest.resolvedTargets);
    expect(adapted.omittedFamilies).toEqual(["edge"]);
    expect(adapted.targets.safari).toBe(15.4);
  });
  it("fails malformed source and incomplete IR feature nodes", () => {
    const badSource = analyzeCompatibility({ mode: "strict", targets: modern,
      sources: source("const bad = ;") });
    expect(badSource.ok).toBe(false);
    expect(badSource.manifest.diagnostics.some(d => d.code === "ZK2002")).toBe(true);
    const badIR = analyzeCompatibility({ mode: "strict", targets: modern,
      ir: [{ irVersion: 1, sourceFile: "x.tsx", nodes: [{ kind: "CompatFeature" }] }] });
    expect(badIR.ok).toBe(false);
    expect(badIR.manifest.diagnostics.some(d => d.code === "ZK2003")).toBe(true);
  });
  it("sanitizes malformed IR feature identifiers instead of leaking source data", () => {
    const secret = "sk-super-private-diagnostic";
    const r = analyzeCompatibility({ mode: "auto", targets: modern,
      ir: [{ irVersion: 1, sourceFile: "x.tsx", nodes: [{ kind: "CompatFeature", feature: secret + " secret" }] }] });
    expect(r.ok).toBe(false);
    expect(serializeManifest(r.manifest)).not.toContain(secret);
    expect(r.manifest.diagnostics.some(d => d.code === "ZK2303")).toBe(true);
  });
  it("rejects eval and Function instead of suggesting global patches", () => {
    const r = analyzeCompatibility({
      mode: "strict", targets: modern, sources: source('eval("1"); new Function("return 1");')
    });
    expect(r.ok).toBe(false);
    expect(r.manifest.unsupportedFeatures).toContain("js.dynamic-code");
  });
  it("provides a pinned registry with explicit evidence and strategy metadata", () => {
    expect(getFeature("web.abort-signal-any")?.strategy.kind).toBe("scoped-ponyfill");
    expect(listFeatures().every(x => x.verification === "metadata-only" && x.evidence.length > 0)).toBe(true);
  });
});

describe("manifest reproducibility and security", () => {
  it("deduplicates feature sites and produces deterministic hashes despite input order", () => {
    const a = { fileName: "a.ts", source: "const x = AbortSignal.timeout(10);" };
    const b = { fileName: "b.ts", source: "const y = AbortSignal.timeout(5);" };
    const one = analyzeCompatibility({ mode: "auto", targets: modern, sources: [a, b] });
    const two = analyzeCompatibility({ mode: "auto", targets: modern, sources: [b, a] });
    expect(serializeManifest(one.manifest)).toBe(serializeManifest(two.manifest));
    expect(one.manifest.hash).toMatch(/^fnv1a64:[0-9a-f]{16}$/);
    expect(validateManifest(one.manifest)).toBe(true);
    expect(validateManifest({ ...one.manifest, estimatedExtraBytes: 999 })).toBe(false);
  });
  it("resolves plans with no network access", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(() => {
      throw new Error("Network access during compatibility analysis");
    });
    try {
      const r = analyzeCompatibility({ mode: "strict", targets: modern,
        sources: source("const c = new AbortController();") });
      expect(r.ok).toBe(true);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });
  it("does not put source content, tokens or secrets in the manifest", () => {
    const secret = "sk-this-is-private-test-material";
    const r = analyzeCompatibility({ mode: "auto", targets: modern,
      sources: source('const secret="' + secret + '"; AbortSignal.any([a]);') });
    expect(serializeManifest(r.manifest)).not.toContain(secret);
    expect(r.manifest.transforms).toEqual([]);
  });
  it("never mutates Promise, fetch or AbortSignal globals", () => {
    const origPromise = globalThis.Promise;
    const origFetch = globalThis.fetch;
    const origAny = AbortSignal.any;
    analyzeCompatibility({ mode: "auto", targets: oldFirefox, sources: source("AbortSignal.any([x]);") });
    expect(globalThis.Promise).toBe(origPromise);
    expect(globalThis.fetch).toBe(origFetch);
    expect(AbortSignal.any).toBe(origAny);
  });
});
