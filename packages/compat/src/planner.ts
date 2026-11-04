import { detectIRFeatures, detectSourceFeatures, detectStylesFeatures } from "./detect.js";
import { getFeature } from "./registry.js";
import { COMPAT_DATA_VERSION, compareVersions, parseMode, resolveTargets, targetLabel } from "./targets.js";
import type {
  BrowserTarget, CompatAnalysisRequest, CompatibilityAnalysis, CompatibilityDiagnostic,
  CompatibilityManifest, FeaturePlan, FeatureReference, FeatureRequirement,
  StrategySelection, TargetConfiguration
} from "./types.js";

const cmp = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
const limitations = Object.freeze([
  "Support thresholds come from pinned documentation metadata, not exhaustive browser execution.",
  "Static analysis cannot prove dynamically computed property names, dependency behavior or runtime feature detection.",
  "Source detection is syntactic and cannot prove whether an identifier shadows a browser global.",
  "No compiler or Vite rewrites are installed by this package. Compiler targetBrowsers currently emits ZC2301.",
  "Scoped timeout uses wall-clock timers; native AbortSignal.timeout uses active time.",
  "CSS compatibility requires explicit semantic feature evidence supplied by Styles; no CSS fallback is inserted."
]);
function sortReferences(values: readonly FeatureReference[]): readonly FeatureReference[] {
  const seen = new Map<string, FeatureReference>();
  for (const item of values) {
    const key = [item.origin, item.file, item.line ?? "", item.column ?? "", item.offset ?? ""].join("|");
    seen.set(key, item);
  }
  return [...seen.values()].sort((a, b) =>
    cmp(a.file, b.file) || (a.offset ?? 0) - (b.offset ?? 0) || cmp(a.origin, b.origin));
}
function stableHash(input: string): string {
  // Deterministic FNV-1a 64-bit identifier, NOT a cryptographic integrity signature.
  let hash = 0xcbf29ce484222325n;
  const bytes = new TextEncoder().encode(input);
  for (const byte of bytes) hash = BigInt.asUintN(64, (hash ^ BigInt(byte)) * 0x100000001b3n);
  return "fnv1a64:" + hash.toString(16).padStart(16, "0");
}
function digest(manifest: Omit<CompatibilityManifest, "hash">): string {
  return stableHash(JSON.stringify(manifest));
}
function label(target: BrowserTarget): string { return targetLabel(target); }
function diagnostic(
  code: string, severity: CompatibilityDiagnostic["severity"], message: string,
  feature?: string, reference?: FeatureReference
): CompatibilityDiagnostic {
  return { code, severity, message, feature, reference };
}
export function analyzeCompatibility(request: CompatAnalysisRequest): CompatibilityAnalysis {
  const mode = parseMode(request.mode);
  const targets = resolveTargets(request.targets, mode);
  const requirements: FeatureRequirement[] = [];
  const diagnostics: CompatibilityDiagnostic[] = [];
  for (const input of request.sources ?? []) {
    const result = detectSourceFeatures(input);
    requirements.push(...result.requirements);
    diagnostics.push(...result.diagnostics.map(d => mode === "strict" ? { ...d, severity: "error" as const } : d));
  }
  for (const ir of request.ir ?? []) {
    const result = detectIRFeatures(ir);
    requirements.push(...result.requirements);
    diagnostics.push(...result.diagnostics);
  }
  const styleResult = detectStylesFeatures(request.cssFeatures ?? []);
  requirements.push(...styleResult.requirements);
  diagnostics.push(...styleResult.diagnostics);

  const byFeature = new Map<string, FeatureRequirement[]>();
  for (const item of requirements) {
    // Never echo arbitrary IR feature values into manifests: malformed data may contain secrets.
    const id = /^[a-z][a-z0-9.-]{0,79}$/.test(item.id) ? item.id : "invalid-feature-id";
    if (id !== item.id) {
      diagnostics.push(diagnostic("ZK2303", "error",
        "Invalid compatibility feature ID supplied by a source adapter.", undefined, item.reference));
    }
    const items = byFeature.get(id) ?? [];
    items.push({ ...item, id });
    byFeature.set(id, items);
  }
  const plans: FeaturePlan[] = [];
  const transformById = new Map<string, StrategySelection>();
  const shimById = new Map<string, StrategySelection>();
  const unsupported: string[] = [];
  for (const id of [...byFeature.keys()].sort(cmp)) {
    const items = byFeature.get(id)!;
    const refs = sortReferences(items.map(item => item.reference));
    const feature = getFeature(id);
    const incompatible = !feature ? targets.map(label) : targets.filter(target => {
      const minimum = feature.minimumSupport[target.browser];
      return minimum === null || compareVersions(target.minimum, minimum) < 0;
    }).map(label);
    if (mode === "off") {
      plans.push({ id, requiredBy: refs, status: "ignored", incompatibleTargets: incompatible });
      continue;
    }
    if (!feature) {
      unsupported.push(id);
      plans.push({ id, requiredBy: refs, status: "unsupported", incompatibleTargets: incompatible });
      diagnostics.push(diagnostic("ZK2301", mode === "strict" ? "error" : "warning",
        "Unregistered feature: " + id + ". No support or safe fallback can be established.", id, refs[0]));
      continue;
    }
    const scopedOnly = items.every(item => item.usage === "scoped-helper");
    const selectedPonyfill = feature.strategy.kind === "scoped-ponyfill" && scopedOnly;
    if (!incompatible.length && !selectedPonyfill) {
      plans.push({ id, requiredBy: refs, status: "native", incompatibleTargets: [] });
      continue;
    }
    if (feature.strategy.kind === "syntax-transform") {
      const strategy = feature.strategy;
      plans.push({ id, requiredBy: refs, status: "transform", incompatibleTargets: incompatible, strategy: strategy.id });
      const existing = transformById.get(strategy.id);
      transformById.set(strategy.id, {
        id: strategy.id, kind: "syntax-transform", reason: [...new Set([...(existing?.reason ?? []), id])].sort(cmp),
        estimatedBytes: strategy.byteEstimate
      });
      continue;
    }
    if (selectedPonyfill) {
      const strategy = feature.strategy;
      plans.push({ id, requiredBy: refs, status: "ponyfill", incompatibleTargets: incompatible, strategy: strategy.id });
      const existing = shimById.get(strategy.id);
      shimById.set(strategy.id, {
        id: strategy.id, kind: "scoped-ponyfill", module: strategy.module,
        reason: [...new Set([...(existing?.reason ?? []), id])].sort(cmp),
        estimatedBytes: strategy.byteEstimate
      });
      if (id === "web.abort-signal-timeout" && incompatible.length) {
        diagnostics.push(diagnostic("ZK2402", "warning",
          "Explicit scopedTimeoutSignal uses wall-clock time, unlike native active-time AbortSignal.timeout.", id, refs[0]));
      }
      continue;
    }
    unsupported.push(id);
    plans.push({ id, requiredBy: refs, status: "unsupported", incompatibleTargets: incompatible });
    const suggestion = feature.strategy.kind === "scoped-ponyfill"
      ? " Replace direct API usage with an explicit @zaakiyjs/compat/abort scoped helper import."
      : " No approved transform or shim is available.";
    diagnostics.push(diagnostic("ZK2302", mode === "strict" ? "error" : "warning",
      id + " is unsupported in " + incompatible.join(", ") + "." + suggestion, id, refs[0]));
  }
  if (mode === "off") diagnostics.push(diagnostic("ZK0001", "info",
    "Compatibility mode is off: no compatibility guarantee, transforms or shims."));
  if (targets.some(target => target.browser === "edge") &&
      (request.cssFeatures?.length ?? 0) > 0) {
    diagnostics.push(diagnostic("ZK2501", "warning",
      "Styles' current BrowserTargets contract has no Edge field; coordinate a CSS target adapter."));
  }

  const orderedDiagnostics = diagnostics.sort((a, b) =>
    cmp(a.code, b.code) || cmp(a.feature ?? "", b.feature ?? "") ||
    cmp(a.reference?.file ?? "", b.reference?.file ?? "") ||
    (a.reference?.offset ?? 0) - (b.reference?.offset ?? 0) || cmp(a.message, b.message));
  const transforms = [...transformById.values()].sort((a, b) => cmp(a.id, b.id));
  const shims = [...shimById.values()].sort((a, b) => cmp(a.id, b.id));
  const normalizedDeclared: TargetConfiguration | null = request.targets ? request.targets.profile
    ? { profile: request.targets.profile } : { browsers: [...(request.targets.browsers ?? [])].sort(cmp) }
    : null;
  const data: Omit<CompatibilityManifest, "hash"> = {
    schemaVersion: 1,
    dataVersion: COMPAT_DATA_VERSION,
    mode,
    declaredTargets: normalizedDeclared,
    resolvedTargets: targets,
    detectedFeatures: plans,
    transforms, shims, unsupportedFeatures: unsupported,
    estimatedExtraBytes: [...transforms, ...shims].reduce((sum, item) => sum + item.estimatedBytes, 0),
    diagnostics: orderedDiagnostics,
    limitations
  };
  const manifest: CompatibilityManifest = { ...data, hash: digest(data) };
  return { ok: !orderedDiagnostics.some(item => item.severity === "error"), manifest };
}
/** Canonical human-readable artifact. Never embeds source text or environment variables. */
export function serializeManifest(manifest: CompatibilityManifest): string {
  return JSON.stringify(manifest, null, 2) + "\n";
}
/** Runtime shape + hash guard for CLI/CI consumers. This is not a JSON-schema package dependency. */
export function validateManifest(value: unknown): value is CompatibilityManifest {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<CompatibilityManifest>;
  if (item.schemaVersion !== 1 || item.dataVersion !== COMPAT_DATA_VERSION ||
      !["off", "auto", "strict"].includes(item.mode ?? "") ||
      !Array.isArray(item.resolvedTargets) || !Array.isArray(item.detectedFeatures) ||
      !Array.isArray(item.transforms) || !Array.isArray(item.shims) ||
      !Array.isArray(item.unsupportedFeatures) || !Array.isArray(item.diagnostics) ||
      !Array.isArray(item.limitations) || typeof item.estimatedExtraBytes !== "number" ||
      typeof item.hash !== "string") return false;
  const { hash, ...unsigned } = item;
  try { return digest(unsigned as Omit<CompatibilityManifest, "hash">) === hash; }
  catch { return false; }
}
export interface StylesTargetAdapter {
  readonly targets: { readonly chrome?: number; readonly firefox?: number; readonly safari?: number };
  readonly omittedFamilies: readonly string[];
}
/** Adapter for @zaakiyjs/styles public StyleConfig.targets; Edge is NOT silently mapped to Chrome. */
export function toStylesTargets(targets: readonly BrowserTarget[]): StylesTargetAdapter {
  const output: { chrome?: number; firefox?: number; safari?: number } = {};
  const omitted: string[] = [];
  for (const target of targets) {
    if (target.browser === "edge") { omitted.push("edge"); continue; }
    output[target.browser] = Number(target.minimum);
  }
  return { targets: output, omittedFamilies: omitted };
}
