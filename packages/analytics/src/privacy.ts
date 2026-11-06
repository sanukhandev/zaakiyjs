import type { EventMetadata, EventValue } from "./types.js";

const KEY = /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/;
const FORBIDDEN = /(?:password|passwd|secret|token|authorization|cookie|card|cvc|cvv|iban|ssn|email|phone|address|document|passport|birth|sessionid|api_?key)/i;
const SUSPICIOUS_VALUE = /(?:bearer\s+\S+|(?:sk|pk)_(?:live|test)_\w+|https?:\/\/|[?&](?:token|key|secret)=|\b\d{12,19}\b)/i;
const MAX_FIELDS = 20;
const MAX_BYTES = 2048;

/** Restrictive event serialization, performed before buffering or sampling. */
export function safeMetadata(input: unknown): EventMetadata {
  if (input === null || typeof input !== "object" || Array.isArray(input) || Object.getPrototypeOf(input) !== Object.prototype) {
    throw new TypeError("Analytics metadata must be a plain object");
  }
  const entries = Object.entries(input);
  if (entries.length > MAX_FIELDS) throw new RangeError("Too many analytics metadata fields");
  const output: Record<string, EventValue> = {};
  for (const [key, value] of entries) {
    if (!KEY.test(key) || FORBIDDEN.test(key)) throw new TypeError("Disallowed analytics metadata key");
    if (value !== null && typeof value !== "string" && typeof value !== "boolean" &&
        !(typeof value === "number" && Number.isFinite(value))) {
      throw new TypeError("Analytics metadata values must be scalar and finite");
    }
    if (typeof value === "string" && (value.length > 256 || SUSPICIOUS_VALUE.test(value))) {
      throw new TypeError("Potentially sensitive analytics metadata value");
    }
    output[key] = value as EventValue;
  }
  if (new TextEncoder().encode(JSON.stringify(output)).byteLength > MAX_BYTES) {
    throw new RangeError("Analytics metadata exceeds 2048 bytes");
  }
  return Object.freeze(output);
}
/** Never transmit full location.href, query strings or fragments. */
export function safePath(path: string): string {
  if (typeof path !== "string" || !path.startsWith("/") || path.startsWith("//") ||
      path.includes("\\") || path.length > 2048 || /[\x00-\x1f\x7f]/.test(path)) {
    throw new TypeError("Invalid same-origin page path");
  }
  const clean = path.split(/[?#]/, 1)[0] || "/";
  try {
    const url = new URL(clean, "https://zaakiy.invalid");
    if (url.origin !== "https://zaakiy.invalid") throw new Error("external");
    return url.pathname;
  } catch { throw new TypeError("Invalid page path"); }
}
export function safeName(name: string): string {
  if (!KEY.test(name) || name.startsWith("__")) throw new TypeError("Invalid analytics event name");
  return name;
}
export function safeOpaqueId(value: string): string {
  if (!/^[a-zA-Z0-9_-]{8,128}$/.test(value)) throw new TypeError("Identity/deduplication ID must be opaque");
  return value;
}
