import type { CanonicalPolicy } from "./types.js";

/** URL parsers accept some malformed escapes. Reject them instead of emitting crawler URLs. */
function assertEncoding(url: URL): void {
  try {
    decodeURI(url.pathname);
    decodeURIComponent(url.search.replace(/\+/g, "%20"));
  } catch {
    throw new TypeError("Malformed URL percent encoding");
  }
}
function siteOrigin(siteURL: string): URL {
  const site = new URL(siteURL);
  if ((site.protocol !== "https:" && site.protocol !== "http:") ||
    site.username || site.password || site.search || site.hash) {
    throw new TypeError("siteURL must be an HTTP(S) origin or base path without credentials, query or fragment");
  }
  return site;
}
export function normalizeCanonical(input: string, policy: CanonicalPolicy): string {
  const site = siteOrigin(policy.siteURL);
  if (input.trim() === "" || /[\u0000-\u001f\u007f]/.test(input) ||
    /^[a-z][a-z0-9+.-]*:/i.test(input) && !/^https?:/i.test(input) ||
    input.startsWith("//") || input.includes("\\")) {
    throw new TypeError("Unsafe canonical URL");
  }
  const url = new URL(input, site);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new TypeError("Unsafe canonical URL");
  }
  const allowed = new Set([site.origin, ...(policy.allowedOrigins ?? []).map(origin => {
    const parsed = siteOrigin(origin);
    return parsed.origin;
  })]);
  if (!allowed.has(url.origin)) throw new TypeError("Untrusted cross-origin canonical URL");
  assertEncoding(url);
  url.hash = "";
  const path = url.pathname.replace(/\/{2,}/g, "/");
  if (policy.trailingSlash === "always" && !path.endsWith("/")) url.pathname = path + "/";
  else if (policy.trailingSlash === "never" && path !== "/") url.pathname = path.replace(/\/+$/, "");
  else url.pathname = path;
  if (policy.query === "strip") url.search = "";
  else if (policy.query && typeof policy.query === "object") {
    const keep = new Set(policy.query.allow);
    const pairs = [...url.searchParams.entries()].filter(([key]) => keep.has(key));
    url.search = "";
    for (const [key, value] of pairs) url.searchParams.append(key, value);
  }
  return url.href;
}
export function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
export const escapeXml = escapeHtml;
