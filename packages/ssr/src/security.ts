import type { HydrationEnvelopeV1, RenderHeadEntryV1 } from "./protocol.js";

const FORBIDDEN = /^(?:__proto__|prototype|constructor|password|secret|token|authorization|cookie|api[_-]?key|private[_-]?key)$/i;
const ATTR = /^[a-z][a-z0-9-]*$/;
export function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
/** Serialize strictly allowlisted PUBLIC leaf paths. Parent names do not authorize
 * whole subtrees; arrays require [] notation (e.g. products[].title).
 */
export function safeJson(value: unknown, allowedPaths: readonly string[], maxBytes = 65_536): string {
  const validPath = /^[A-Za-z_$][\w$-]*(?:\[\])?(?:\.[A-Za-z_$][\w$-]*(?:\[\])?)*$/;
  if (!Array.isArray(allowedPaths) || allowedPaths.length < 1 || allowedPaths.length > 256 ||
      allowedPaths.some(path => typeof path !== "string" || path.length > 256 || !validPath.test(path)) ||
      !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 1_048_576) {
    throw new TypeError("Hydration requires a bounded public-leaf path allowlist");
  }
  const allowed = new Set(allowedPaths);
  const paths = [...allowed];
  const admits = (path: string): boolean => allowed.has(path) ||
    paths.some(candidate => candidate.startsWith(path + ".") || candidate.startsWith(path + "[]"));
  const seen = new Set<object>();
  const walk = (item: unknown, depth: number, path: string): unknown => {
    if (depth > 8) throw new TypeError("Hydration payload exceeds depth limit");
    if (!admits(path) && path !== "") throw new TypeError("Unapproved hydration path: " + path);
    if (item === null || typeof item === "string" || typeof item === "boolean" ||
        (typeof item === "number" && Number.isFinite(item))) {
      if (!allowed.has(path)) throw new TypeError("Unapproved hydration leaf: " + path);
      return item;
    }
    if (typeof item !== "object") throw new TypeError("Unsupported hydration data");
    if (seen.has(item)) throw new TypeError("Cyclic hydration data");
    seen.add(item);
    let output: unknown;
    if (Array.isArray(item)) {
      if (Object.getPrototypeOf(item) !== Array.prototype || item.length > 4096) {
        throw new TypeError("Unsafe hydration array");
      }
      const descriptors = Object.getOwnPropertyDescriptors(item);
      if (Object.keys(descriptors).some(key => key !== "length" && !/^(?:0|[1-9][0-9]*)$/.test(key))) {
        throw new TypeError("Unexpected hydration array property");
      }
      const result: unknown[] = [];
      for (let i = 0; i < item.length; i++) {
        const property = descriptors[String(i)];
        if (!property || !("value" in property)) throw new TypeError("Sparse or accessor hydration array");
        result.push(walk(property.value, depth + 1, path + "[]"));
      }
      output = result;
    } else {
      const proto: unknown = Object.getPrototypeOf(item);
      if (proto !== null && proto !== Object.prototype) throw new TypeError("Unsafe hydration object prototype");
      const record: Record<string, unknown> = Object.create(null);
      for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(item))) {
        if (FORBIDDEN.test(key) || !/^[A-Za-z_$][\w$-]{0,127}$/.test(key)) {
          throw new TypeError("Sensitive or malformed hydration key");
        }
        if (!("value" in descriptor)) throw new TypeError("Hydration getters are forbidden");
        const childPath = path ? path + "." + key : key;
        if (!admits(childPath)) throw new TypeError("Unapproved hydration field: " + childPath);
        record[key] = walk(descriptor.value, depth + 1, childPath);
      }
      output = record;
    }
    seen.delete(item);
    return output;
  };
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Hydration root must be an object");
  }
  const json = JSON.stringify(walk(value, 0, ""))
    .replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
  if (new TextEncoder().encode(json).byteLength > maxBytes) throw new TypeError("Hydration exceeds byte limit");
  return json;
}
export function serializeHydration(envelope: HydrationEnvelopeV1, publicFields: readonly string[]): string {
  if (envelope.schema !== "zaakiy.hydration/1" || envelope.domAbiVersion !== 1 ||
      !/^[a-f0-9]{64}$/.test(envelope.buildId) ||
      typeof envelope.routeId !== "string" ||
      !/^[a-zA-Z0-9][\w.-]{0,199}$/.test(envelope.routeId) ||
      !Array.isArray(envelope.boundaries) || envelope.boundaries.length > 4096) {
    throw new TypeError("Incompatible hydration envelope");
  }
  const markers = new Set<string>();
  const boundaries: { markerId: string; templateDigest: string }[] = [];
  for (const boundary of envelope.boundaries) {
    if (!/^[a-f0-9]{32,64}$/.test(boundary.markerId) ||
        !/^[a-f0-9]{64}$/.test(boundary.templateDigest) ||
        markers.has(boundary.markerId)) throw new TypeError("Invalid or duplicate hydration marker");
    markers.add(boundary.markerId);
    boundaries.push({ markerId: boundary.markerId, templateDigest: boundary.templateDigest });
  }
  // Only an explicitly allowed public payload is embedded in the envelope.
  const payload: unknown = JSON.parse(safeJson(envelope.payload, publicFields));
  const json = JSON.stringify({
    schema: "zaakiy.hydration/1", buildId: envelope.buildId, domAbiVersion: 1,
    routeId: envelope.routeId, boundaries, payload
  }).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
  if (new TextEncoder().encode(json).byteLength > 70_000) throw new TypeError("Hydration envelope exceeds byte limit");
  return json;
}
export function safeLocation(value: string, origin: string): string {
  if (value.includes("\\") || [...value].some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127) ||
      value.startsWith("//")) throw new TypeError("Unsafe redirect");
  const target = new URL(value, origin);
  if (!["http:", "https:"].includes(target.protocol) || target.origin !== new URL(origin).origin ||
      target.username || target.password) throw new TypeError("Redirect must be same origin");
  return target.pathname + target.search + target.hash;
}
const allowedAttributes: Record<RenderHeadEntryV1["tag"], ReadonlySet<string>> = {
  title: new Set(), meta: new Set(["name", "property", "content", "charset"]),
  link: new Set(["rel", "href", "hreflang", "type", "sizes", "media"]),
  "script-jsonld": new Set(["nonce"])
};
export function serializeHead(entries: readonly RenderHeadEntryV1[], siteOrigin: string, nonce?: string): string {
  let html = "";
  for (const entry of entries) {
    const attrs: string[] = [];
    for (const [name, value] of Object.entries(entry.attributes ?? {})) {
      if (!ATTR.test(name) || !allowedAttributes[entry.tag].has(name) || typeof value !== "string") {
        throw new TypeError("Unsafe head attribute");
      }
      if (name === "href") {
        const parsed = new URL(value, siteOrigin);
        if (parsed.protocol !== "https:" || parsed.username || parsed.password ||
            parsed.origin !== new URL(siteOrigin).origin) throw new TypeError("Unsafe head URL");
      }
      if (name === "nonce" && value !== nonce) throw new TypeError("Invalid script nonce");
      attrs.push(" " + name + "=\"" + escapeHtml(value) + "\"");
    }
    if (entry.tag === "title") {
      if (attrs.length) throw new TypeError("Title must not have attributes");
      html += "<title>" + escapeHtml(entry.text ?? "") + "</title>";
    } else if (entry.tag === "meta" || entry.tag === "link") {
      if (entry.text !== undefined) throw new TypeError("Void head element cannot contain text");
      html += "<" + entry.tag + attrs.join("") + ">";
    } else {
      if (!nonce) throw new TypeError("JSON-LD script requires CSP nonce");
      if ((entry.text?.length ?? 0) > 65_536) throw new TypeError("JSON-LD exceeds size limit");
      const value: unknown = JSON.parse(entry.text ?? "null");
      const check = (node: unknown, depth: number): void => {
        if (depth > 8) throw new TypeError("JSON-LD exceeds depth limit");
        if (node && typeof node === "object") {
          for (const [key, child] of Object.entries(node)) {
            if (/^(?:__proto__|constructor|prototype)$/.test(key)) throw new TypeError("Unsafe JSON-LD key");
            check(child, depth + 1);
          }
        }
      };
      check(value, 0);
      const normalized = JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e")
        .replace(/&/g, "\\u0026").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
      html += "<script type=\"application/ld+json\" nonce=\"" + escapeHtml(nonce) +
        "\">" + normalized + "</script>";
    }
  }
  return html;
}
export function htmlDocument(body: string, entries: readonly RenderHeadEntryV1[], origin: string, nonce?: string): string {
  return "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\">" +
    serializeHead(entries, origin, nonce) + "</head><body>" + body + "</body></html>";
}
