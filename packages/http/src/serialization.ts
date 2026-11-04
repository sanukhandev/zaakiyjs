import { HttpError, configError } from "./errors.js";
import { assertActive, awaitActive } from "./cancellation.js";
import type { ResponseType } from "./types.js";

export function serializeBody(value: unknown, headers: Headers): BodyInit | null {
  if (value === undefined || value === null) return null;
  if (typeof value === "string") {
    if (!headers.has("content-type")) headers.set("content-type", "text/plain;charset=UTF-8");
    return value;
  }
  if (value instanceof FormData || value instanceof URLSearchParams || value instanceof Blob ||
      value instanceof ArrayBuffer || ArrayBuffer.isView(value) || value instanceof ReadableStream) {
    if (value instanceof URLSearchParams && !headers.has("content-type"))
      headers.set("content-type", "application/x-www-form-urlencoded;charset=UTF-8");
    return value as BodyInit;
  }
  if (typeof value === "object" || typeof value === "number" || typeof value === "boolean") {
    if (!headers.has("content-type")) headers.set("content-type", "application/json");
    try { return JSON.stringify(value); } catch (cause) { throw new HttpError("REQUEST_VALIDATION", "Could not serialize request body", undefined, { cause }); }
  }
  throw configError("Unsupported request body");
}
export function replayable(body: BodyInit | null): boolean { return !(body instanceof ReadableStream); }
function modeFrom(response: Response, requested: ResponseType): ResponseType {
  if (requested !== "auto") return requested;
  const type = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (type.includes("application/json") || type.includes("+json")) return "json";
  if (type.startsWith("text/") || type.includes("xml")) return "text";
  return "arrayBuffer";
}
async function readLimited(response: Response, max: number, signal: AbortSignal): Promise<Uint8Array> {
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null && Number(contentLength) > max) throw new HttpError("UNSUPPORTED", "Response exceeds configured byte limit");
  if (!response.body) {
    const bytes = new Uint8Array(await awaitActive(response.arrayBuffer(), signal));
    if (bytes.byteLength > max) throw new HttpError("UNSUPPORTED", "Response exceeds configured byte limit");
    return bytes;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const item = await awaitActive(reader.read(), signal);
      if (item.done) break;
      total += item.value.byteLength;
      if (total > max) throw new HttpError("UNSUPPORTED", "Response exceeds configured byte limit");
      chunks.push(item.value);
    }
    const combined = new Uint8Array(total);
    let cursor = 0;
    for (const chunk of chunks) { combined.set(chunk, cursor); cursor += chunk.length; }
    return combined;
  } finally {
    if (signal.aborted || total > max) void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
export async function parseResponse(response: Response, requested: ResponseType, maxBytes: number, signal: AbortSignal): Promise<unknown> {
  assertActive(signal);
  if (response.status === 204 || response.status === 205) return null;
  if (requested === "stream") {
    // Streaming returns control of the body to the caller; byte limits cannot be enforced here.
    return response.body;
  }
  if (response.bodyUsed) throw new HttpError("UNSUPPORTED", "Response body already consumed");
  const bytes = await readLimited(response, maxBytes, signal);
  assertActive(signal);
  if (!bytes.byteLength) return null;
  const mode = modeFrom(response, requested);
  if (mode === "arrayBuffer") return bytes.buffer;
  if (mode === "blob") {
    const binary = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(binary).set(bytes);
    return new Blob([binary], { type: response.headers.get("content-type") ?? "" });
  }
  const decoded = new TextDecoder().decode(bytes);
  if (mode === "text") return decoded;
  if (mode === "json") {
    try { return JSON.parse(decoded) as unknown; }
    catch (cause) { throw new HttpError("PARSE", "Invalid JSON response", undefined, { cause }); }
  }
  throw configError("Unsupported response mode");
}
