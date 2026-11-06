export interface RobotsDirectives {
  readonly index?: boolean;
  readonly follow?: boolean;
  readonly noarchive?: boolean;
  readonly nosnippet?: boolean;
  readonly noimageindex?: boolean;
}
export interface SocialMetadata {
  readonly title?: string;
  readonly description?: string;
  readonly image?: string;
  readonly type?: string;
  readonly siteName?: string;
}
export interface TwitterMetadata {
  readonly card?: "summary" | "summary_large_image";
  readonly title?: string;
  readonly description?: string;
  readonly image?: string;
  readonly site?: string;
  readonly creator?: string;
}
export interface StructuredData {
  readonly "@context"?: string;
  readonly "@type": string;
  readonly [key: string]: unknown;
}
export type StructuredDataInput = StructuredData | readonly StructuredData[];
export interface Metadata {
  readonly title?: string;
  readonly description?: string;
  readonly canonical?: string;
  readonly robots?: RobotsDirectives;
  readonly openGraph?: SocialMetadata;
  readonly twitter?: TwitterMetadata;
  readonly author?: string;
  readonly publisher?: string;
  readonly locale?: string;
  readonly alternates?: Readonly<Record<string, string>>;
  readonly structuredData?: StructuredDataInput;
}
export interface PageMetadataContext<Data = unknown, Params extends Readonly<Record<string, string>> = Readonly<Record<string, string>>> {
  readonly data: Data;
  readonly params: Params;
  readonly locale?: string;
  readonly status?: number;
}
export type MetadataDefinition<Data = unknown, Params extends Readonly<Record<string, string>> = Readonly<Record<string, string>>> =
  Metadata | ((context: PageMetadataContext<Data, Params>) => Metadata);
export interface CanonicalPolicy {
  readonly siteURL: string;
  readonly trailingSlash?: "always" | "never" | "preserve";
  readonly query?: "preserve" | "strip" | { readonly allow: readonly string[] };
  /** Only trusted, explicitly configured cross-origin destinations. */
  readonly allowedOrigins?: readonly string[];
}
export interface ResolveMetadataOptions<Data = unknown, Params extends Readonly<Record<string, string>> = Readonly<Record<string, string>>> extends CanonicalPolicy {
  readonly data?: Data;
  readonly params?: Params;
  readonly locale?: string;
  readonly status?: number;
  readonly private?: boolean;
}
export interface ResolvedMetadata extends Omit<Metadata, "canonical" | "robots" | "openGraph" | "alternates"> {
  readonly canonical?: string;
  readonly robots: Required<Pick<RobotsDirectives, "index" | "follow">> & RobotsDirectives;
  readonly openGraph?: SocialMetadata;
  readonly alternates?: Readonly<Record<string, string>>;
}
export type HeadTag =
  | { readonly kind: "title"; readonly key: "title"; readonly text: string }
  | { readonly kind: "meta"; readonly key: string; readonly attributes: Readonly<Record<string, string>> }
  | { readonly kind: "link"; readonly key: string; readonly attributes: Readonly<Record<string, string>> }
  | { readonly kind: "script"; readonly key: string; readonly attributes: Readonly<Record<string, string>>; readonly text: string };
export interface RenderedMetadata {
  readonly metadata: ResolvedMetadata;
  readonly tags: readonly HeadTag[];
  readonly html: string;
  readonly headers: Readonly<Record<string, string>>;
}
export type DiagnosticSeverity = "error" | "warning" | "info";
export interface SeoDiagnostic {
  readonly code: string;
  readonly severity: DiagnosticSeverity;
  readonly message: string;
  readonly path?: string;
}
export interface AuditOptions {
  readonly status?: number;
  readonly private?: boolean;
  readonly existingTags?: readonly HeadTag[];
  readonly sitemapIncluded?: boolean;
  readonly locale?: string;
}
