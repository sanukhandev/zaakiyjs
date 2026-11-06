import type { StructuredData, StructuredDataInput } from "./types.js";

/** Baseline schema validation, deliberately not a claim of Google rich-result eligibility. */
const required: Readonly<Record<string, readonly string[]>> = {
  Organization: ["name"],
  WebSite: ["name", "url"],
  WebPage: ["name"],
  BreadcrumbList: ["itemListElement"],
  Article: ["headline"],
  Product: ["name"],
  FAQPage: ["mainEntity"],
  LocalBusiness: ["name"],
  SoftwareApplication: ["name", "applicationCategory"]
};
export function defineStructuredData<T extends StructuredData>(value: T): T {
  validateStructuredData(value);
  return value;
}
export function validateStructuredData(input: StructuredDataInput): void {
  const seen = new WeakSet<object>();
  const checkValue = (value: unknown, depth: number): void => {
    if (depth > 30) throw new TypeError("Structured data exceeds maximum depth");
    if (typeof value === "function" || typeof value === "symbol" ||
        typeof value === "bigint" || typeof value === "undefined" ||
        typeof value === "number" && !Number.isFinite(value)) {
      throw new TypeError("Unsupported structured data value");
    }
    if (value === null || typeof value !== "object") return;
    if (seen.has(value)) throw new TypeError("Circular structured data");
    seen.add(value);
    if (Array.isArray(value)) for (const item of value) checkValue(item, depth + 1);
    else {
      for (const [key, item] of Object.entries(value)) {
        if (key === "__proto__" || key === "constructor" || key === "prototype") {
          throw new TypeError("Unsafe structured data key");
        }
        checkValue(item, depth + 1);
      }
    }
    seen.delete(value);
  };
  const entries = Array.isArray(input) ? input : [input];
  for (const entry of entries) {
    if (!entry || typeof entry["@type"] !== "string" || !entry["@type"].trim()) {
      throw new TypeError("Structured data requires @type");
    }
    const keys = required[entry["@type"]] ?? [];
    for (const key of keys) {
      const value = entry[key];
      if (value === undefined || value === null || value === "" || Array.isArray(value) && !value.length) {
        throw new TypeError(entry["@type"] + " requires " + key);
      }
    }
    if (entry["@context"] !== undefined && entry["@context"] !== "https://schema.org") {
      throw new TypeError("Unsupported structured data @context");
    }
  }
  checkValue(input, 0);
}
export function serializeJsonLd(input: StructuredDataInput): string {
  validateStructuredData(input);
  const entries = (Array.isArray(input) ? input : [input]) as readonly StructuredData[];
  const value = entries.map(entry => ({ "@context": "https://schema.org", ...entry }));
  return JSON.stringify(value.length === 1 ? value[0] : value)
    .replace(/</g, "\\u003c").replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026").replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}
