/** Build-time Zaakiy Styles public contracts. The M0 fields remain source-compatible. */
export interface BrandIdentity { readonly name: string; readonly slug?: string }
export interface BrandTypography {
  readonly fontSizes?: Readonly<Record<string, string>>;
  readonly fontWeights?: Readonly<Record<string, string>>;
  readonly lineHeights?: Readonly<Record<string, string>>;
  readonly letterSpacing?: Readonly<Record<string, string>>;
}
export interface BrandMotion {
  readonly durations?: Readonly<Record<string, string>>;
  readonly easings?: Readonly<Record<string, string>>;
}
export interface BrandOverride {
  readonly colors?: Readonly<Record<string, string>>;
  readonly spacing?: Readonly<Record<string, string>>;
  readonly fonts?: Readonly<Record<string, string>>;
  readonly radii?: Readonly<Record<string, string>>;
  readonly shadows?: Readonly<Record<string, string>>;
  readonly typography?: BrandTypography;
  readonly motion?: BrandMotion;
}
export interface BrandTokens extends BrandOverride {
  readonly identity?: BrandIdentity;
  readonly breakpoints?: Readonly<Record<string, string>>;
  readonly appearance?: { readonly light?: BrandOverride; readonly dark?: BrandOverride };
}
export interface BrowserTargets { readonly chrome?: number; readonly firefox?: number; readonly safari?: number }
export interface StyleConfig {
  readonly brand: BrandTokens;
  readonly mode?: "light" | "dark" | "system";
  readonly safelist?: readonly string[];
  readonly targets?: BrowserTargets;
}
export interface ExtractedStyleToken { readonly token: string; readonly file: string; readonly offset: number }
export interface StyleCompilerRequest {
  readonly tokens: readonly ExtractedStyleToken[];
  readonly config: StyleConfig;
  readonly minify?: boolean;
}
export interface StyleDiagnostic {
  readonly code: string;
  readonly message: string;
  readonly token?: string;
  readonly file?: string;
  readonly offset?: number;
  readonly severity?: "error" | "warning";
}
export interface StyleMetrics {
  readonly inputCount: number;
  readonly uniqueCount: number;
  readonly estimatedUndeduplicatedBytes: number;
  readonly generatedBytes: number;
}
export interface StyleCompilerResult {
  readonly css: string;
  readonly sourceMap?: string;
  readonly diagnostics: readonly StyleDiagnostic[];
  readonly tokenIds: Readonly<Record<string, string>>;
  readonly metrics?: StyleMetrics;
}
