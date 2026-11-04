/** M0 TYPE CONTRACT ONLY. Utility parsing/CSS extraction are not implemented. */
export const foundationStatus = { package: "@zaakiyjs/styles", implemented: false } as const;
export interface BrandTokens {
  readonly colors?: Readonly<Record<string, string>>;
  readonly spacing?: Readonly<Record<string, string>>;
  readonly fonts?: Readonly<Record<string, string>>;
  readonly radii?: Readonly<Record<string, string>>;
  readonly breakpoints?: Readonly<Record<string, string>>;
}
export interface StyleConfig { readonly brand: BrandTokens; readonly mode?: "light" | "dark" | "system"; readonly safelist?: readonly string[] }
export interface ExtractedStyleToken { readonly token: string; readonly file: string; readonly offset: number }
export interface StyleCompilerRequest { readonly tokens: readonly ExtractedStyleToken[]; readonly config: StyleConfig; readonly minify?: boolean }
export interface StyleCompilerResult { readonly css: string; readonly sourceMap?: string; readonly diagnostics: readonly { readonly code: string; readonly message: string; readonly token?: string }[]; readonly tokenIds: Readonly<Record<string, string>> }
