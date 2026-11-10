/** Universal SEO: browser globals are not touched at import time. */
export { defineMetadata, definePageMetadata, resolveMetadata, renderMetadata,
  metadataToTags, serializeHeadTags, robotsContent, auditMetadata } from "./metadata.js";
export { normalizeCanonical, escapeHtml, escapeXml } from "./url.js";
export { defineStructuredData, validateStructuredData, serializeJsonLd } from "./structured.js";
export { generateRobotsTxt } from "./robots.js";
export { generateSitemaps, generateSitemapIndex, planSitemapRebuild, auditHreflang } from "./sitemap.js";
export { resolveRouteMetadata } from "./routes.js";
export type { RouteSeoConfig } from "./routes.js";
export type {
  Metadata, MetadataDefinition, PageMetadataContext, ResolveMetadataOptions,
  ResolvedMetadata, CanonicalPolicy, SocialMetadata, TwitterMetadata, RobotsDirectives,
  StructuredData, StructuredDataInput, HeadTag, RenderedMetadata,
  SeoDiagnostic, AuditOptions, DiagnosticSeverity
} from "./types.js";
export type { RobotsGroup, RobotsTxtOptions } from "./robots.js";
export type { SitemapEntry, SitemapOptions, GeneratedSitemap, SitemapIndexEntry, SitemapBuild, HreflangPage } from "./sitemap.js";

export { resolveSeoV1, seoToRenderHeadV1, seoRobotsHeaderV1, createSeoHeadAdapterV1, generateSitemapsFromFeedV1 } from "./protocol.js";
export type { JsonLdValueV1, SeoRobotsV1, SeoDocumentV1, SeoResolveInputV1, SeoFactoryV1,
  SeoResolutionV1, SitemapEntryV1, SitemapFeedV1, RenderHeadEntryV1, RenderHeadAdapterV1,
  SeoResolveOptionsV1, SeoRouteBindingV1, SitemapFeedOptionsV1 } from "./protocol.js";

export { auditSeoV1 } from "./audit-v1.js";
export type { SeoAuditInputV1 } from "./audit-v1.js";
