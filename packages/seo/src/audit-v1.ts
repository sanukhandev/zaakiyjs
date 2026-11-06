import type { SeoDiagnostic } from "./types.js";
import type { SeoResolutionV1 } from "./protocol.js";
import { serializeJsonLd } from "./structured.js";
export interface SeoAuditInputV1 {
  readonly resolution: SeoResolutionV1;
  readonly visibility: "public" | "private" | "draft";
  readonly sitemapIncluded?: boolean;
  readonly existingCanonicalCount?: number;
  readonly expectedLocale?: string;
}
export function auditSeoV1(input: SeoAuditInputV1): readonly SeoDiagnostic[] {
  const { resolution, visibility } = input;
  const metadata = resolution.metadata;
  const issues: SeoDiagnostic[] = [];
  const report = (code: string, severity: SeoDiagnostic["severity"], message: string): void => {
    issues.push({ code, severity, message });
  };
  if (resolution.version !== 1 || metadata.version !== 1)
    report("SEO300", "error", "Invalid versioned SEO protocol");
  if (resolution.status === 200 && visibility === "public") {
    if (!metadata.title?.trim()) report("SEO301", "error", "Missing/empty indexable title");
    if (!metadata.description?.trim()) report("SEO302", "warning", "Missing meta description");
    if (!metadata.canonical) report("SEO303", "error", "Missing absolute canonical");
  }
  if (metadata.canonical) {
    try {
      const url = new URL(metadata.canonical);
      if (url.protocol !== "https:" || url.username || url.password || url.hash ||
        url.href !== metadata.canonical) throw new TypeError("Unsafe canonical");
    } catch { report("SEO304", "error", "Invalid or unsafe canonical"); }
  }
  const forbidden = visibility !== "public" || resolution.status >= 400 ||
    resolution.status >= 300 && resolution.status < 400;
  if (forbidden && metadata.robots?.index !== false)
    report("SEO305", "error", "Nonpublic, error or redirect response is indexable");
  if (forbidden && (metadata.jsonLd?.length || metadata.canonical))
    report("SEO306", "error", "Private or status-error response leaks discovery metadata");
  if (input.sitemapIncluded && (forbidden || metadata.robots?.index === false))
    report("SEO307", "error", "Nonindexable page appears in sitemap");
  if (input.existingCanonicalCount && input.existingCanonicalCount > 1)
    report("SEO308", "error", "Duplicate canonical tags in rendered document");
  if (resolution.status >= 300 && resolution.status < 400 && !resolution.redirect)
    report("SEO309", "error", "Redirect status without validated Location");
  if (metadata.jsonLd) {
    try {
      serializeJsonLd(metadata.jsonLd as unknown as import("./types.js").StructuredDataInput);
    } catch (error) {
      report("SEO310", "error", error instanceof Error ? error.message : "Invalid JSON-LD");
    }
  }
  if (input.expectedLocale && metadata.locale !== input.expectedLocale)
    report("SEO311", "warning", "Locale metadata does not match expected page locale");
  if (!metadata.openGraph?.images?.length)
    report("SEO312", "info", "No Open Graph preview image");
  return issues;
}
