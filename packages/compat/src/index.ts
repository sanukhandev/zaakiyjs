/** Build-time entrypoint. Never import this from a browser application bundle. */
export { analyzeCompatibility, serializeManifest, validateManifest, toStylesTargets } from "./planner.js";
export { parseMode, resolveTargets, compareVersions, targetLabel, COMPAT_DATA_VERSION } from "./targets.js";
export { FEATURE_REGISTRY, getFeature, listFeatures } from "./registry.js";
export { detectIRFeatures, detectSourceFeatures, detectStylesFeatures } from "./detect.js";
export { transformEmittedJavaScript } from "./transform.js";
export type {
  BrowserFamily, BrowserTarget, CompatibilityProfile, CompatMode, FeatureCategory,
  StrategyKind, FeatureDefinition, FeatureReference, FeatureRequirement, CompatIRNode,
  CompatIRDocument, SourceInput, CssFeatureEvidence, CompatAnalysisRequest,
  CompatibilityAnalysis, CompatibilityManifest, CompatibilityDiagnostic, FeaturePlan,
  StrategySelection, TargetConfiguration
} from "./types.js";
export type { StylesTargetAdapter } from "./planner.js";
export type { JavaScriptTransformRequest } from "./transform.js";
export const foundationStatus = { package: "@zaakiyjs/compat", implemented: true } as const;
