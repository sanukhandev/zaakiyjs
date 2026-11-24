/**
 * H5 opt-in hydration state transport. This module never reads executable
 * scripts or uses HTML injection. Transfer only explicitly supplied public,
 * JSON-compatible data; never pass auth tokens, secrets or private loader data.
 */
export interface HydrationStatePacketV1 {
  readonly schema: "zaakiy.hydration-state/1";
  readonly buildId: string;
  readonly routeId: string;
  readonly value: JsonHydrationValue;
}
export type JsonHydrationValue = null | boolean | string | number |
  readonly JsonHydrationValue[] | { readonly [key: string]: JsonHydrationValue };

const HASH = /^[a-f0-9]{64}$/;
const ROUTE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,199}$/;
const MAX_BYTES = 65536;
const MAX_DEPTH = 32;
const MAX_ITEMS = 4096;
const FORBIDDEN = new Set(["__proto__", "constructor", "prototype"]);
const encoder = new TextEncoder();

function normalize(value: unknown, seen: WeakSet<object>, depth: number,
  count: { value: number }): JsonHydrationValue {
  if (++count.value > MAX_ITEMS || depth > MAX_DEPTH)
    throw new RangeError("Hydration state exceeds depth/item budget");
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "object")
    throw new TypeError("Hydration state must contain only JSON values");
  if (seen.has(value)) throw new TypeError("Cyclic/shared hydration state is not supported");
  seen.add(value);
  if (Array.isArray(value)) {
    const result: JsonHydrationValue[] = [];
    for (let i = 0; i < value.length; i++) {
      if (!Object.hasOwn(value, i))
        throw new TypeError("Sparse hydration state arrays are forbidden");
      const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
      if (!descriptor || !Object.hasOwn(descriptor, "value"))
        throw new TypeError("Hydration state accessors are forbidden");
      result.push(normalize(descriptor.value, seen, depth + 1, count));
    }
    return result;
  }
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null)
    throw new TypeError("Hydration state must use plain objects");
  const result: Record<string, JsonHydrationValue> = Object.create(null);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || FORBIDDEN.has(key))
      throw new TypeError("Unsafe hydration state property");
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable)
      throw new TypeError("Nonenumerable hydration state properties are forbidden");
    if (!Object.hasOwn(descriptor, "value"))
      throw new TypeError("Hydration state getters are forbidden");
    result[key] = normalize(descriptor.value, seen, depth + 1, count);
  }
  return result;
}
function checkIdentity(buildId: string, routeId: string): void {
  if (!HASH.test(buildId) || !ROUTE.test(routeId))
    throw new TypeError("Invalid hydration build/route identity");
}
/**
 * Produces safe JSON text suitable for a non-executable
 * <script type="application/json"> node. Consumers must set textContent,
 * never innerHTML. Encoder escapes '<' to prevent script-end injection.
 */
export function serializeHydrationState(buildId: string, routeId: string,
  publicState: unknown): string {
  checkIdentity(buildId, routeId);
  const value = normalize(publicState, new WeakSet(), 0, { value: 0 });
  const text = JSON.stringify({
    schema: "zaakiy.hydration-state/1", buildId, routeId, value
  }).replace(/</g, "\\u003c").replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
  if (encoder.encode(text).byteLength > MAX_BYTES)
    throw new RangeError("Hydration state exceeds byte budget");
  return text;
}
/**
 * Parses untrusted JSON text against the expected deployment identities.
 * Never automatically merges parsed data with application state.
 */
export function parseHydrationState(text: string, buildId: string,
  routeId: string): JsonHydrationValue {
  checkIdentity(buildId, routeId);
  if (typeof text !== "string" || encoder.encode(text).byteLength > MAX_BYTES)
    throw new RangeError("Hydration state exceeds byte budget");
  const packet: unknown = JSON.parse(text);
  if (!packet || typeof packet !== "object" || Array.isArray(packet))
    throw new TypeError("Invalid hydration state packet");
  const fields = packet as Record<string, unknown>;
  if (Reflect.ownKeys(fields).length !== 4 ||
      fields.schema !== "zaakiy.hydration-state/1" ||
      fields.buildId !== buildId || fields.routeId !== routeId ||
      !Object.hasOwn(fields, "value"))
    throw new TypeError("Hydration state identity mismatch");
  return normalize(fields.value, new WeakSet(), 0, { value: 0 });
}
