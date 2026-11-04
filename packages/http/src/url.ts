import { configError } from "./errors.js";
import type { QueryParams, QueryValue } from "./types.js";
const supported = new Set(["http:", "https:"]);
function baseUrl(raw: string): URL {
  try {
    const fallback = typeof globalThis.location !== "undefined" ? globalThis.location.href : undefined;
    const url = new URL(raw, fallback);
    if (!supported.has(url.protocol) || url.username || url.password) throw new Error();
    return url;
  } catch { throw configError("baseURL must resolve to an HTTP(S) URL without embedded credentials"); }
}
export function originPolicy(base: string, additional: readonly string[] = []): { base: URL; allowed: ReadonlySet<string> } {
  const root = baseUrl(base);
  const allowed = new Set([root.origin]);
  for (const item of additional) {
    const parsed = baseUrl(item);
    if (parsed.href !== parsed.origin + "/") throw configError("allowedOrigins must contain origins only");
    allowed.add(parsed.origin);
  }
  return { base: root, allowed };
}
function appendQuery(target: URL, query: QueryParams | undefined): void {
  if (!query) return;
  for (const [key, raw] of Object.entries(query)) {
    const values: readonly QueryValue[] = Array.isArray(raw) ? raw : [raw];
    for (const value of values) {
      if (value === undefined || value === null) continue;
      if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean")
        throw configError("Unsupported query parameter type");
      target.searchParams.append(key, String(value));
    }
  }
}
export function resolveUrl(input: string, base: URL, allowed: ReadonlySet<string>, query?: QueryParams): URL {
  if (typeof input !== "string" || !input || input.startsWith("//") || input.includes("\\"))
    throw configError("Invalid or ambiguous request URL");
  let url: URL;
  try {
    const absolute = /^[A-Za-z][A-Za-z0-9+.-]*:/.test(input);
    // A baseURL such as /api/ prefixes shorthand paths such as /users.
    // This is deliberate Fetch-client behavior, not standard URL root resolution.
    const root = new URL(base.href);
    if (!root.pathname.endsWith("/")) root.pathname += "/";
    const target = absolute ? input : input.startsWith("/") ? input.slice(1) : input;
    url = new URL(target, root);
    if (!absolute && url.origin === base.origin && !url.pathname.startsWith(root.pathname))
      throw configError("Request path must remain under the configured base URL");
  } catch (cause) {
    if (cause instanceof Error && "code" in cause) throw cause;
    throw configError("Invalid request URL");
  }
  if (!supported.has(url.protocol) || url.username || url.password) throw configError("Unsupported request URL");
  if (!allowed.has(url.origin)) throw configError("Request origin is not allowed");
  url.hash = "";
  appendQuery(url, query);
  return url;
}
