import { abortableDelay, abortedReason, awaitAbortable } from "./abort.js";
import { ConfigurationError, isCancellation } from "./errors.js";
export interface RetryOptions {
  /** Total number of attempts, including the first (never an unbounded retry count). */
  readonly maxAttempts: number;
  readonly baseDelayMs?: number;
  readonly maxDelayMs?: number;
  /** Fraction in [0, 1] applied as positive delay jitter. Defaults to zero. */
  readonly jitter?: number;
  readonly shouldRetry?: (error: unknown, attempt: number) => boolean;
}
export function validateRetry(options?: RetryOptions): void {
  if (!options) return;
  if (!Number.isSafeInteger(options.maxAttempts) || options.maxAttempts < 1 || options.maxAttempts > 20) {
    throw new ConfigurationError("retry.maxAttempts must be an integer between 1 and 20");
  }
  for (const [name, value] of [["baseDelayMs", options.baseDelayMs], ["maxDelayMs", options.maxDelayMs]] as const) {
    if (value !== undefined && (!Number.isFinite(value) || value < 0)) {
      throw new ConfigurationError("retry." + name + " must be finite and nonnegative");
    }
  }
  if (options.jitter !== undefined && (!Number.isFinite(options.jitter) || options.jitter < 0 || options.jitter > 1)) {
    throw new ConfigurationError("retry.jitter must be between 0 and 1");
  }
}
export async function runWithRetry<T>(
  execute: (attempt: number) => Promise<T>,
  signal: AbortSignal,
  options?: RetryOptions
): Promise<T> {
  const maxAttempts = options?.maxAttempts ?? 1;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (signal.aborted) throw abortedReason(signal);
    try {
      // Invocation happens in a microtask so synchronous throws are observed and classified.
      return await awaitAbortable(Promise.resolve().then(() => execute(attempt)), signal);
    } catch (error) {
      if (signal.aborted) throw abortedReason(signal);
      if (isCancellation(error)) throw error;
      if (attempt >= maxAttempts || (options?.shouldRetry && !options.shouldRetry(error, attempt))) throw error;
      const base = options?.baseDelayMs ?? 100;
      const cap = options?.maxDelayMs ?? 30_000;
      const delay = Math.min(cap, base * 2 ** (attempt - 1));
      const jittered = delay * (1 + Math.random() * (options?.jitter ?? 0));
      await abortableDelay(jittered, signal);
    }
  }
  throw new ConfigurationError("retry attempts exhausted unexpectedly");
}
