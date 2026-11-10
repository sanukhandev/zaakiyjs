/** Versioned ZaakiyJS compiler IR and deterministic TSX-to-DOM compilation API. */
export const foundationStatus = { package: "@zaakiyjs/compiler", implemented: true } as const;
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
export interface KeyedLoop extends IRNodeBase { readonly kind: "KeyedLoop"; readonly collection: IRExpression; readonly key: IRExpression; readonly body: readonly IRNode[]; readonly itemParameter?: string }
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


import { analyze } from "./analysis.js";
import { emitJavaScript, loweringDiagnostics, typeDiagnostics } from "./generate.js";
import { collectStyleTokens, optimizeIR, validateIR, OPTIMIZATION_PASSES } from "./optimize.js";
export { optimizeIR, validateIR, OPTIMIZATION_PASSES };

/** Analyze a TSX source and return a stable JSON-serializable IR v1 document. */
export function parseToIR(request: CompileRequest): { document: IRDocument; diagnostics: readonly CompilerDiagnostic[] } {
  const parsed = analyze(request);
  return { document: parsed.document, diagnostics: parsed.diagnostics };
}

/**
 * Emit exact offsets for finite dynamic class candidates. Legacy static CSS
 * tokens remain strings and can be recovered by the stable styles extractor.
 * No incorrect source offset is ever fabricated for the build pipeline.
 */
function styleTokenManifest(nodes: readonly IRNode[], source: string): readonly (
  string | { readonly token: string; readonly offset: number }
)[] {
  const located = new Map<string, number>();
  const visit = (node: IRNode): void => {
    if (node.kind === "StyleToken") {
      const offset = node.span.start.offset;
      if (node.span.end.offset - offset === node.token.length &&
          source.slice(offset, offset + node.token.length) === node.token &&
          !located.has(node.token)) {
        located.set(node.token, offset);
      }
    } else if (node.kind === "StaticElement") node.children.forEach(visit);
    else if (node.kind === "ConditionalBlock") {
      node.whenTrue.forEach(visit);
      node.whenFalse.forEach(visit);
    } else if (node.kind === "KeyedLoop") node.body.forEach(visit);
  };
  nodes.forEach(visit);
  return collectStyleTokens(nodes).map(token => {
    const offset = located.get(token);
    return offset === undefined ? token : { token, offset };
  });
}

/** Compile a supported TSX source file. Fatal diagnostics always suppress generated assets. */
export function compile(request: CompileRequest): CompileResult {
  const parsed = analyze(request);
  const ir = optimizeIR(parsed.document);
  const compatibilityDiagnostics: CompilerDiagnostic[] = request.targetBrowsers?.length
    ? [{
        code: "ZC2301", severity: "error",
        message: "Explicit browser targets require an approved compatibility profile and transforms. M0/M1 has no frozen browser-target matrix; refusing to promise compatibility."
      }]
    : [];
  const diagnostics = [
    ...parsed.diagnostics,
    ...loweringDiagnostics(ir),
    ...typeDiagnostics(request, parsed),
    ...compatibilityDiagnostics
  ];
  const unique = new Map<string, CompilerDiagnostic>();
  for (const diagnostic of diagnostics) {
    const key = diagnostic.code + ":" + (diagnostic.span?.start.offset ?? -1) + ":" + diagnostic.message;
    unique.set(key, diagnostic);
  }
  const ordered = [...unique.values()].sort((a, b) =>
    (a.span?.start.offset ?? 0) - (b.span?.start.offset ?? 0) ||
    a.code.localeCompare(b.code));
  const manifest = {
    domAbiVersion: 1,
    irVersion: IR_SCHEMA_VERSION,
    optimizationPasses: [...OPTIMIZATION_PASSES],
    styleTokens: styleTokenManifest(ir.nodes, request.source),
    targetBrowsers: [...(request.targetBrowsers ?? [])].sort()
  } as const;
  if (ordered.some(d => d.severity === "error")) {
    return { irVersion: IR_SCHEMA_VERSION, js: [], css: [], diagnostics: ordered, manifest };
  }
  try {
    const asset = emitJavaScript(request, parsed, ir);
    return { irVersion: IR_SCHEMA_VERSION, js: [asset], css: [], diagnostics: ordered, manifest };
  } catch (error) {
    return {
      irVersion: IR_SCHEMA_VERSION, js: [], css: [],
      diagnostics: [...ordered, {
        code: error instanceof Error && /^ZC\d{4}:/.test(error.message)
          ? error.message.slice(0, 6) : "ZC9001",
        severity: "error",
        message: error instanceof Error ? error.message : "Unexpected compiler emission failure."
      }],
      manifest
    };
  }
}
