import { BlockList, isIP } from "node:net";
import type { ProxyRoute, ProxyUpstream } from "./types.js";

export class ProxyConfigurationError extends Error { constructor(message: string) { super(message); this.name = "ProxyConfigurationError"; } }
export class ProxyPolicyError extends Error { constructor(message = "Request rejected") { super(message); this.name = "ProxyPolicyError"; } }
export class ProxyUpstreamError extends Error { constructor(message = "Upstream unavailable") { super(message); this.name = "ProxyUpstreamError"; } }
export class ProxyPayloadError extends Error { constructor() { super("Payload too large"); this.name = "ProxyPayloadError"; } }
export class ProxyTimeoutError extends Error { constructor() { super("Upstream timed out"); this.name = "ProxyTimeoutError"; } }
const methods = new Set(["GET", "HEAD", "OPTIONS", "POST", "PUT", "PATCH", "DELETE"]);
const forbiddenHop = new Set(["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade", "host", "forwarded", "x-forwarded-for", "x-forwarded-host", "x-forwarded-proto", "x-real-ip", "content-length"]);
const sensitive = new Set(["authorization", "proxy-authorization", "cookie", "set-cookie", "location", "www-authenticate", "x-api-key", "x-internal-token"]);
const allowedDefaultRequest = ["accept", "accept-language", "content-type", "content-encoding", "if-none-match", "if-modified-since", "range", "user-agent"];
const allowedDefaultResponse = ["content-type", "content-encoding", "etag", "last-modified", "content-range", "accept-ranges", "content-disposition"];
const validHeaderName = /^[a-z][a-z0-9!#$%&'*+.^_|~-]*$/;

export function assertCount(value: number | undefined, fallback: number, label: string, max = 2 ** 31 - 1): number {
  const number = value ?? fallback;
  if (!Number.isSafeInteger(number) || number < 1 || number > max) throw new ProxyConfigurationError("Invalid " + label);
  return number;
}
export function assertMethod(method: string): string {
  if (!methods.has(method)) throw new ProxyPolicyError("Unsupported method");
  return method;
}
export function cleanOrigin(upstream: ProxyUpstream): URL {
  if (typeof upstream.origin !== "string" || !/^https?:\/\//i.test(upstream.origin)) throw new ProxyConfigurationError("Upstream origin must be HTTP(S)");
  let url: URL;
  try { url = new URL(upstream.origin); } catch { throw new ProxyConfigurationError("Malformed upstream origin"); }
  if (!url.hostname || url.username || url.password || url.pathname !== "/" || url.search || url.hash || upstream.origin.includes("\\")) throw new ProxyConfigurationError("Upstream origin must not contain credentials, path, query or fragment");
  if (url.protocol !== "https:" && !(url.protocol === "http:" && upstream.allowInsecureHttp === true)) throw new ProxyConfigurationError("Plain HTTP requires explicit approval");
  if (url.hostname === "localhost" || url.hostname.endsWith(".localhost") || url.hostname.endsWith(".local")) {
    if (!upstream.allowedPrivateAddresses?.length) throw new ProxyConfigurationError("Local destinations require explicit exact-address approval");
  }
  assertCount(upstream.connectTimeoutMs, 5_000, "connectTimeoutMs", 120_000);
  assertCount(upstream.timeoutMs, 30_000, "timeoutMs", 300_000);
  assertCount(upstream.maxResponseBytes, 8_388_608, "maxResponseBytes", 100_000_000);
  for (const address of upstream.allowedPrivateAddresses ?? []) {
    if (!isIP(address)) throw new ProxyConfigurationError("Private address allowlist requires canonical IP literals");
  }
  if (upstream.basePath !== undefined) validateBasePath(upstream.basePath);
  return url;
}

const blocked = new BlockList();
for (const [ip, bits] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
  ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15],
  ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4]
] as const) blocked.addSubnet(ip, bits, "ipv4");
for (const [ip, bits] of [
  ["::", 128], ["::1", 128], ["::ffff:0:0", 96], ["64:ff9b:1::", 48], ["100::", 64],
  ["2001::", 32], ["2001:db8::", 32], ["2002::", 16], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8]
] as const) blocked.addSubnet(ip, bits, "ipv6");

export function allowedAddress(address: string, upstream: ProxyUpstream): boolean {
  const family = isIP(address);
  if (family !== 4 && family !== 6) return false;
  if (upstream.allowedPrivateAddresses?.includes(address)) return true;
  if (family === 4) return !blocked.check(address, "ipv4");
  // Only globally routable IPv6 within 2000::/3; no mapped, tunneling or reserved prefixes.
  const publicIpv6 = new BlockList(); publicIpv6.addSubnet("2000::", 3, "ipv6");
  return publicIpv6.check(address, "ipv6") && !blocked.check(address, "ipv6");
}
export function validateBasePath(path: string): void {
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("?") || path.includes("#") || path.includes("\\") || path.includes("%") || path.split("/").some(segment => segment === ".." || segment === ".")) throw new ProxyConfigurationError("Unsafe upstream base path");
}
export function incomingURL(value: string): URL {
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\") || value.includes("#") || [...value].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) throw new ProxyPolicyError("Invalid request URL");
  const path = value.split("?", 1)[0] ?? "";
  if (path.includes("//") || /%(?:(?:2e|2f|5c|00|25(?:2e|2f|5c)))/i.test(path)) throw new ProxyPolicyError("Ambiguous path encoding");
  try { decodeURIComponent(path); decodeURIComponent(value.slice(path.length)); } catch { throw new ProxyPolicyError("Malformed URL encoding"); }
  if (path.split("/").includes("..") || path.split("/").includes(".")) throw new ProxyPolicyError("Traversal is not allowed");
  let url: URL;
  try { url = new URL(value, "https://request.invalid"); } catch { throw new ProxyPolicyError("Invalid request URL"); }
  if (url.origin !== "https://request.invalid" || url.username || url.password || url.hash) throw new ProxyPolicyError("Authority override not allowed");
  return url;
}
export interface CompiledRoute { readonly route: ProxyRoute; readonly regex: RegExp; readonly params: readonly string[]; readonly score: number }
export function compileRoutes(routes: readonly ProxyRoute[], upstreams: Readonly<Record<string, ProxyUpstream>>): CompiledRoute[] {
  if (!routes.length) throw new ProxyConfigurationError("At least one proxy route is required");
  const compiled: CompiledRoute[] = [];
  const routeIds = new Set<string>();
  for (const route of routes) {
    if (!route.id || routeIds.has(route.id)) throw new ProxyConfigurationError("Duplicate or missing route ID");
    routeIds.add(route.id);
    if (!Object.hasOwn(upstreams, route.upstream)) throw new ProxyConfigurationError("Unknown upstream");
    if (route.access !== "public" && route.access !== "authenticated") throw new ProxyConfigurationError("Explicit route access is required");
    if (route.access === "authenticated" && !route.authorize) throw new ProxyConfigurationError("Protected routes require authorization");
    if (!route.methods?.length || route.methods.some(m => !methods.has(m) || m !== m.toUpperCase())) throw new ProxyConfigurationError("Invalid allowed methods");
    if (new Set(route.methods).size !== route.methods.length) throw new ProxyConfigurationError("Duplicate route method");
    if (route.path !== "/" && (!route.path.startsWith("/") || route.path.includes("//") || route.path.includes("?") || route.path.includes("#") || route.path.includes("\\"))) throw new ProxyConfigurationError("Invalid route path");
    if (route.path.split("/").includes("..") || /%/.test(route.path)) throw new ProxyConfigurationError("Encoded route definitions are forbidden");
    if (route.rateLimit) { assertCount(route.rateLimit.max, 1, "rateLimit.max"); assertCount(route.rateLimit.windowMs, 1, "rateLimit.windowMs"); }
    assertCount(route.maxRequestBytes, 1_048_576, "maxRequestBytes", 100_000_000);
    assertCount(route.timeoutMs, 30_000, "route timeout", 300_000);
    if (route.retry && (!route.methods.every(m => m === "GET" || m === "HEAD") || ![1, 2].includes(route.retry.attempts))) throw new ProxyConfigurationError("Retries must be bounded and safe-method only");
    for (const name of [...route.requestHeaders ?? [], ...route.responseHeaders ?? []]) if (!validHeaderName.test(name.toLowerCase()) || forbiddenHop.has(name.toLowerCase())) throw new ProxyConfigurationError("Unsafe custom header");
    const segments = route.path.split("/").slice(1);
    const params: string[] = [];
    const prefix = segments.at(-1) === "*";
    if (prefix) segments.pop();
    if (segments.some(s => s === "*")) throw new ProxyConfigurationError("Wildcard only allowed at end");
    const pattern = segments.map(segment => {
      if (segment.startsWith(":")) {
        const name = segment.slice(1);
        if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(name) || params.includes(name)) throw new ProxyConfigurationError("Invalid route parameter");
        params.push(name); return "([^/]+)";
      }
      if (!/^[a-zA-Z0-9._~-]+$/.test(segment) && segment !== "") throw new ProxyConfigurationError("Invalid route segment");
      return segment.replace(/[.*+?^$()|[\]\\{}]/g, "\\$&");
    }).join("/");
    const exact = "/" + pattern;
    const regex = new RegExp(prefix ? "^" + (exact === "/" ? "" : exact) + "(?:/.*)?$" : "^" + exact + "$");
    compiled.push({ route, regex, params, score: prefix ? 0 : params.length ? 1 : 2 });
  }
  for (let i = 0; i < compiled.length; i++) for (let j = i + 1; j < compiled.length; j++) {
    const a = compiled[i]!; const b = compiled[j]!;
    if (!a.route.methods.some(m => b.route.methods.includes(m))) continue;
    const sample = (path: string): string => path.replace(/\*/g, "child").replace(/:[a-zA-Z][a-zA-Z0-9_]*/g, "value");
    if (a.regex.test(sample(b.route.path)) || b.regex.test(sample(a.route.path))) throw new ProxyConfigurationError("Ambiguous route overlap");
  }
  return compiled.sort((a, b) => b.score - a.score || b.route.path.length - a.route.path.length);
}
function hopByHop(input: Readonly<Record<string, string | string[] | undefined>>): Set<string> {
  const denied = new Set(forbiddenHop);
  for (const [name, value] of Object.entries(input)) {
    if (name.toLowerCase() !== "connection") continue;
    for (const part of (Array.isArray(value) ? value.join(",") : value ?? "").split(",")) {
      const token = part.trim().toLowerCase();
      if (token) denied.add(token);
    }
  }
  return denied;
}
export function requestHeaders(input: Readonly<Record<string, string | string[] | undefined>>, custom?: readonly string[]): Record<string, string> {
  const allowed = new Set([...allowedDefaultRequest, ...custom ?? []].map(x => x.toLowerCase()));
  const denied = hopByHop(input);
  const result: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const [name, value] of Object.entries(input)) {
    const key = name.toLowerCase();
    if (!allowed.has(key) || denied.has(key) || sensitive.has(key) || value === undefined) continue;
    if (typeof value !== "string" || /[\r\n]/.test(value)) continue;
    result[key] = value;
  }
  return result;
}
export function responseHeaders(input: Readonly<Record<string, string | string[] | undefined>>, custom?: readonly string[]): Record<string, string> {
  const allowed = new Set([...allowedDefaultResponse, ...custom ?? []].map(x => x.toLowerCase()));
  const denied = hopByHop(input);
  const result: Record<string, string> = Object.create(null) as Record<string, string>;
  result["cache-control"] = "no-store";
  result["x-content-type-options"] = "nosniff";
  for (const [name, value] of Object.entries(input)) {
    const key = name.toLowerCase();
    if (!allowed.has(key) || denied.has(key) || sensitive.has(key) || value === undefined) continue;
    if (typeof value !== "string" || /[\r\n]/.test(value)) continue;
    result[key] = value;
  }
  return result;
}
export function safeCredentialHeaders(value: Readonly<Record<string, string>>): Record<string, string> {
  const headers: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const [name, credential] of Object.entries(value)) {
    const key = name.toLowerCase();
    if (!["authorization", "x-api-key"].includes(key) || typeof credential !== "string" || /[\r\n]/.test(credential)) throw new ProxyPolicyError("Disallowed upstream credential header");
    headers[key] = credential;
  }
  return headers;
}
