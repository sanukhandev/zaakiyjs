/** Universal SEO: browser globals are not touched at import time. */
export { defineMetadata, definePageMetadata, resolveMetadata, renderMetadata,
  metadataToTags, serializeHeadTags, robotsContent, auditMetadata } from "./metadata.js";
export { normalizeCanonical, escapeHtml, escapeXml } from "./url.js";
export { defineStructuredData, validateStructuredData, serializeJsonLd } from "./structured.js";
export { generateRobotsTxt } from "./robots.js";
export { generateSitemaps, generateSitemapIndex, planSitemapRebuild, auditHreflang } from "./sitemap.js";
export type {
  Metadata, MetadataDefinition, PageMetadataContext, ResolveMetadataOptions,
  ResolvedMetadata, CanonicalPolicy, SocialMetadata, TwitterMetadata, RobotsDirectives,
  StructuredData, StructuredDataInput, HeadTag, RenderedMetadata,
  SeoDiagnostic, AuditOptions, DiagnosticSeverity
} from "./types.js";
export type { RobotsGroup, RobotsTxtOptions } from "./robots.js";
export type { SitemapEntry, SitemapOptions, GeneratedSitemap, SitemapIndexEntry, SitemapBuild, HreflangPage } from "./sitemap.js";
