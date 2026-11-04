/** M0 VERSIONED IR + RESULT TYPES ONLY. No TSX compiler is implemented. */
export const foundationStatus = { package: "@zaakiyjs/compiler", implemented: false } as const;
export const IR_SCHEMA_VERSION = 1 as const;
export type IRVersion = typeof IR_SCHEMA_VERSION;
export interface SourceSpan { readonly file: string; readonly start: { readonly line: number; readonly column: number; readonly offset: number }; readonly end: { readonly line: number; readonly column: number; readonly offset: number } }
export type Purity = "pure" | "impure" | "unknown";
export interface IRExpression { readonly source: string; readonly span: SourceSpan; readonly purity: Purity; readonly reactive: boolean }
export interface IRNodeBase { readonly id: string; readonly span: SourceSpan }
export interface StaticText extends IRNodeBase { readonly kind: "StaticText"; readonly text: string }
export interface StaticElement extends IRNodeBase { readonly kind: "StaticElement"; readonly tag: string; readonly namespace: "html" | "svg" | "mathml"; readonly children: readonly IRNode[] }
export interface DynamicText extends IRNodeBase { readonly kind: "DynamicText"; readonly expression: IRExpression }
export interface PropertyBinding extends IRNodeBase { readonly kind: "PropertyBinding"; readonly name: string; readonly target: "property" | "attribute" | "class" | "style"; readonly expression: IRExpression }
export interface EventBinding extends IRNodeBase { readonly kind: "EventBinding"; readonly name: string; readonly expression: IRExpression }
export interface ConditionalBlock extends IRNodeBase { readonly kind: "ConditionalBlock"; readonly condition: IRExpression; readonly whenTrue: readonly IRNode[]; readonly whenFalse: readonly IRNode[] }
export interface KeyedLoop extends IRNodeBase { readonly kind: "KeyedLoop"; readonly collection: IRExpression; readonly key: IRExpression; readonly body: readonly IRNode[] }
export interface ComponentCall extends IRNodeBase { readonly kind: "ComponentCall"; readonly component: string; readonly props: readonly PropertyBinding[] }
export interface StyleToken extends IRNodeBase { readonly kind: "StyleToken"; readonly token: string; readonly variant?: string }
export interface CompatFeature extends IRNodeBase { readonly kind: "CompatFeature"; readonly feature: string; readonly targets: readonly string[] }
export type IRNode = StaticText | StaticElement | DynamicText | PropertyBinding | EventBinding | ConditionalBlock | KeyedLoop | ComponentCall | StyleToken | CompatFeature;
export interface IRDocument { readonly irVersion: IRVersion; readonly sourceFile: string; readonly nodes: readonly IRNode[] }
export type DiagnosticSeverity = "error" | "warning" | "info";
export interface CompilerDiagnostic { readonly code: string; readonly severity: DiagnosticSeverity; readonly message: string; readonly span?: SourceSpan }
export interface GeneratedAsset { readonly fileName: string; readonly code: string; readonly map?: string }
export interface CompileResult { readonly irVersion: IRVersion; readonly js: readonly GeneratedAsset[]; readonly css: readonly GeneratedAsset[]; readonly diagnostics: readonly CompilerDiagnostic[]; readonly manifest?: Readonly<Record<string, unknown>> }
export interface CompileRequest { readonly fileName: string; readonly source: string; readonly rootDir?: string; readonly targetBrowsers?: readonly string[] }
