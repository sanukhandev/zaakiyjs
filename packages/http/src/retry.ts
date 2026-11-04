import { configError, HttpError } from "./errors.js";
import { abortDelay } from "./cancellation.js";
import type { HttpMethod, RetryPolicy } from "./types.js";
const retryStatus = [408, 429, 500, 502, 503, 504];
export interface RetryConfig {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  maxElapsedMs: number;
  jitter: boolean;
  statusCodes: readonly number[];
  retryNetworkErrors: boolean;
  allowUnsafeMethods: boolean;
}
export function normalizeRetry(input?: RetryPolicy | false): RetryConfig {
  const policy: RetryPolicy = input === false ? { maxAttempts: 1 } : (input ?? {});
  const result = {
    maxAttempts: policy.maxAttempts ?? 1, baseDelayMs: policy.baseDelayMs ?? 200,
    maxDelayMs: policy.maxDelayMs ?? 5000, maxElapsedMs: policy.maxElapsedMs ?? 30000,
    jitter: policy.jitter ?? false, statusCodes: policy.statusCodes ?? retryStatus,
    retryNetworkErrors: policy.retryNetworkErrors ?? true, allowUnsafeMethods: policy.allowUnsafeMethods ?? false
  };
  if (!Number.isSafeInteger(result.maxAttempts) || result.maxAttempts < 1 || result.maxAttempts > 10)
    throw configError("retry.maxAttempts must be between 1 and 10");
  for (const [name, value] of [["baseDelayMs", result.baseDelayMs], ["maxDelayMs", result.maxDelayMs],
    ["maxElapsedMs", result.maxElapsedMs]] as const)
    if (!Number.isFinite(value) || value < 0) throw configError("retry." + name + " must be nonnegative and finite");
  if (result.maxDelayMs < result.baseDelayMs) throw configError("maxDelayMs cannot be less than baseDelayMs");
  if (result.maxElapsedMs === 0) throw configError("retry.maxElapsedMs must be positive");
  if (result.statusCodes.some(x => !Number.isInteger(x) || x < 400 || x > 599))
    throw configError("retry.statusCodes must contain valid HTTP error status codes");
  return result;
}
export function retryAllowed(method: HttpMethod, policy: RetryConfig, key: string | undefined): boolean {
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return true;
  return policy.allowUnsafeMethods && typeof key === "string" && key.length > 0;
}
export function canRetry(error: HttpError, policy: RetryConfig): boolean {
  return (error.code === "NETWORK" && policy.retryNetworkErrors) ||
    (error.code === "HTTP_STATUS" && error.status !== undefined &&
     error.status !== 401 && error.status !== 403 && policy.statusCodes.includes(error.status));
}
export async function waitRetry(
  attempt: number, policy: RetryConfig, signal: AbortSignal, started: number, retryAfter: string | null
): Promise<boolean> {
  let ms = Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** (attempt - 1));
  // Jitter affects exponential backoff, never the server's Retry-After minimum.
  if (policy.jitter) ms *= Math.random();
  if (retryAfter) {
    const seconds = Number(retryAfter);
    const date = Date.parse(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) ms = Math.max(ms, seconds * 1000);
    else if (Number.isFinite(date)) ms = Math.max(ms, date - Date.now());
  }
  if (Date.now() - started + ms > policy.maxElapsedMs) return false;
  await abortDelay(ms, signal);
  return true;
}
