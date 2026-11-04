import type { BrowserFamily, CompatibilityStrategy, FeatureDefinition } from "./types.js";

const unsupported: CompatibilityStrategy = { kind: "unsupported", id: "unsupported", byteEstimate: 0, security: "No unapproved global patch" };
const tsES2019: CompatibilityStrategy = {
  kind: "syntax-transform", id: "typescript-5.9.3-es2019", byteEstimate: 0,
  security: "Host must run an approved TypeScript compiler transform on emitted JavaScript; no eval"
};
const abortAny: CompatibilityStrategy = {
  kind: "scoped-ponyfill", id: "abort-any", module: "@zaakiyjs/compat/abort", byteEstimate: 570,
  security: "Explicit import, scoped signals and listeners; never overwrites AbortSignal.any"
};
const abortTimeout: CompatibilityStrategy = {
  kind: "scoped-ponyfill", id: "abort-timeout", module: "@zaakiyjs/compat/abort", byteEstimate: 420,
  security: "Explicit import, scoped timer with disposal; not equivalent to active-time native timeout"
};
function add(
  id: string,
  category: FeatureDefinition["category"],
  minimum: [string | null, string | null, string | null, string | null],
  strategy: CompatibilityStrategy,
  detection: string,
  evidence: string
): FeatureDefinition {
  const names: BrowserFamily[] = ["chrome", "edge", "firefox", "safari"];
  const support = Object.fromEntries(names.map((browser, i) => [browser, minimum[i]])) as unknown as Record<BrowserFamily, string | null>;
  return Object.freeze({
    id, category, minimumSupport: Object.freeze(support), strategy, detection,
    verification: "metadata-only" as const, evidence
  });
}
/** Conservative pinned minimum versions; these thresholds are metadata, not browser conformance tests. */
export const FEATURE_REGISTRY: readonly FeatureDefinition[] = Object.freeze([
  add("js.optional-chaining", "syntax", ["80", "80", "74", "13.1"], tsES2019, "TS AST questionDotToken", "MDN JavaScript optional chaining"),
  add("js.nullish-coalescing", "syntax", ["80", "80", "72", "13.1"], tsES2019, "TS AST ?? token", "MDN JavaScript nullish coalescing"),
  add("js.logical-assignment", "syntax", ["85", "85", "79", "14"], tsES2019, "TS AST ??=, ||= and &&=", "MDN logical assignment operators"),
  add("js.dynamic-code", "builtin", [null, null, null, null], unsupported, "eval() or new Function()", "Unapproved dynamic code execution forbidden by ZaakiyJS security contract"),
  add("module.dynamic-import", "module", ["63", "79", "67", "11.1"], unsupported, "TS AST import() call", "MDN dynamic import; bundler output may vary"),
  add("web.abort-controller", "web-api", ["66", "79", "57", "12.1"], unsupported, "Identifier/new AbortController; native required", "MDN AbortController; Safari 11.1 partial fetch cancellation excluded"),
  add("web.abort-signal-any", "web-api", ["116", "116", "124", "17.4"], abortAny, "AbortSignal.any property access", "MDN AbortSignal.any browser support"),
  add("web.abort-signal-timeout", "web-api", ["124", "124", "100", "16"], abortTimeout, "AbortSignal.timeout property access", "MDN AbortSignal.timeout browser support"),
  add("web.abort-reason", "web-api", ["98", "98", "97", "15.4"], unsupported, "AbortSignal.reason/AbortController.abort(reason)", "MDN AbortSignal.reason browser support"),
  add("web.fetch", "web-api", ["42", "79", "39", "10.1"], unsupported, "global fetch() call", "MDN Fetch API"),
  add("web.resize-observer", "web-api", ["64", "79", "69", "13.1"], unsupported, "new ResizeObserver", "MDN ResizeObserver"),
  add("web.structured-clone", "builtin", ["98", "98", "94", "15.4"], unsupported, "global structuredClone()", "MDN structuredClone"),
  add("css.selector-has", "css", ["105", "105", "121", "15.4"], unsupported, "Styles semantic CSS feature evidence", "MDN :has() selector"),
  add("css.container-query", "css", ["105", "105", "110", "16"], unsupported, "Styles semantic CSS feature evidence", "MDN CSS size container queries"),
  add("css.nesting", "css", ["120", "120", "117", "17.2"], unsupported, "Styles semantic CSS feature evidence", "MDN CSS nesting"),
  add("css.color-mix", "css", ["111", "111", "113", "16.2"], unsupported, "Styles semantic CSS feature evidence", "MDN color-mix()")
].sort((a, b) => a.id.localeCompare(b.id)));

const map = new Map(FEATURE_REGISTRY.map(feature => [feature.id, feature]));
export function getFeature(id: string): FeatureDefinition | undefined { return map.get(id); }
export function listFeatures(): readonly FeatureDefinition[] { return FEATURE_REGISTRY; }
