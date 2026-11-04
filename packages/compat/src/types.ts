/** Build-time contracts. None of these types requires a browser runtime. */
export type CompatMode = "off" | "auto" | "strict";
export type BrowserFamily = "chrome" | "edge" | "firefox" | "safari";
export type CompatibilityProfile = "modern-2024" | "legacy-2020";
export type FeatureCategory = "syntax" | "builtin" | "web-api" | "css" | "module";
export type StrategyKind = "native" | "syntax-transform" | "scoped-ponyfill" | "unsupported";
export type DiagnosticSeverity = "error" | "warning" | "info";

export interface BrowserTarget {
  readonly browser: BrowserFamily;
  readonly minimum: string;
  readonly maximum?: string;
}
export interface TargetConfiguration {
  /** Either explicit targets OR one version-pinned profile. */
  readonly browsers?: readonly string[];
  readonly profile?: CompatibilityProfile;
}
export interface SourceInput { readonly fileName: string; readonly source: string }
export interface FeatureReference {
  readonly origin: "source" | "ir" | "css";
  readonly file: string;
  readonly line?: number;
  readonly column?: number;
  readonly offset?: number;
}
export interface FeatureRequirement { readonly id: string; readonly reference: FeatureReference }
/** Accept the public JSON-compatible compiler IR shape without importing its runtime. */
export interface CompatIRNode {
  readonly kind: string;
  readonly feature?: string;
  readonly span?: { readonly file: string; readonly start: { readonly line: number; readonly column: number; readonly offset: number } };
  readonly children?: readonly CompatIRNode[];
  readonly whenTrue?: readonly CompatIRNode[];
  readonly whenFalse?: readonly CompatIRNode[];
  readonly body?: readonly CompatIRNode[];
  readonly props?: readonly CompatIRNode[];
}
export interface CompatIRDocument {
  readonly irVersion: number;
  readonly sourceFile: string;
  readonly nodes: readonly CompatIRNode[];
}
export interface CssFeatureEvidence {
  /** The styles compiler supplies semantic feature IDs; compat never parses private CSS implementation data. */
  readonly feature: string;
  readonly file: string;
  readonly offset?: number;
}
export interface CompatAnalysisRequest {
  readonly mode?: CompatMode;
  readonly targets?: TargetConfiguration;
  readonly sources?: readonly SourceInput[];
  readonly ir?: readonly CompatIRDocument[];
  readonly cssFeatures?: readonly CssFeatureEvidence[];
  /** The opt-in helper import is required before a scoped ponyfill can be selected. */
  readonly explicitPonyfills?: readonly ("abort-any" | "abort-timeout")[];
}
export interface CompatibilityDiagnostic {
  readonly code: string;
  readonly severity: DiagnosticSeverity;
  readonly message: string;
  readonly feature?: string;
  readonly reference?: FeatureReference;
}
export interface CompatibilityStrategy {
  readonly kind: StrategyKind;
  readonly id: string;
  readonly module?: string;
  readonly byteEstimate: number;
  readonly security: string;
}
export interface FeatureDefinition {
  readonly id: string;
  readonly category: FeatureCategory;
  readonly detection: string;
  /** Lower bound of reported support in the PINNED data snapshot; not browser-test proof. Null is unknown. */
  readonly minimumSupport: Readonly<Record<BrowserFamily, string | null>>;
  readonly strategy: CompatibilityStrategy;
  readonly verification: "metadata-only" | "browser-tested";
  readonly evidence: string;
}
export interface FeaturePlan {
  readonly id: string;
  readonly requiredBy: readonly FeatureReference[];
  readonly status: "native" | "transform" | "ponyfill" | "unsupported" | "ignored";
  readonly incompatibleTargets: readonly string[];
  readonly strategy?: string;
}
export interface StrategySelection {
  readonly id: string;
  readonly kind: "syntax-transform" | "scoped-ponyfill";
  readonly module?: string;
  readonly reason: readonly string[];
  readonly estimatedBytes: number;
}
export interface CompatibilityManifest {
  readonly schemaVersion: 1;
  readonly dataVersion: string;
  readonly mode: CompatMode;
  readonly declaredTargets: TargetConfiguration | null;
  readonly resolvedTargets: readonly BrowserTarget[];
  readonly detectedFeatures: readonly FeaturePlan[];
  readonly transforms: readonly StrategySelection[];
  readonly shims: readonly StrategySelection[];
  readonly unsupportedFeatures: readonly string[];
  readonly estimatedExtraBytes: number;
  readonly diagnostics: readonly CompatibilityDiagnostic[];
  readonly limitations: readonly string[];
  readonly hash: string;
}
export interface CompatibilityAnalysis {
  readonly ok: boolean;
  readonly manifest: CompatibilityManifest;
}
