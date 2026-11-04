import { HttpError, configError } from "./errors.js";

const timeoutMarker = Symbol("http-timeout");
export interface Operation {
  readonly signal: AbortSignal;
  abort(reason?: unknown): void;
  dispose(): void;
}
export function isAbort(signal: AbortSignal): boolean { return signal.aborted; }
export function abortError(signal: AbortSignal): HttpError {
  const timeout = signal.reason === timeoutMarker;
  return new HttpError(timeout ? "TIMEOUT" : "CANCELLED", timeout ? "HTTP request timed out" : "HTTP request cancelled",
    undefined, { cause: timeout ? undefined : signal.reason });
}
export function assertActive(signal: AbortSignal): void {
  if (signal.aborted) throw abortError(signal);
}
export function createOperation(caller: AbortSignal | undefined, timeoutMs: number | undefined): Operation {
  if (timeoutMs !== undefined && (!Number.isFinite(timeoutMs) || timeoutMs <= 0)) throw configError("timeoutMs must be finite and positive");
  const controller = new AbortController();
  const fromCaller = (): void => { if (!controller.signal.aborted) controller.abort(caller?.reason); };
  if (caller?.aborted) fromCaller();
  else caller?.addEventListener("abort", fromCaller, { once: true });
  const timeout = timeoutMs !== undefined && !controller.signal.aborted ?
    setTimeout(() => controller.abort(timeoutMarker), timeoutMs) : undefined;
  return {
    signal: controller.signal,
    abort: reason => { if (!controller.signal.aborted) controller.abort(reason); },
    dispose: () => {
      caller?.removeEventListener("abort", fromCaller);
      if (timeout !== undefined) clearTimeout(timeout);
    }
  };
}
/** Races non-cooperative transports, interceptors and parsers without leaking listeners. */
export function awaitActive<T>(work: PromiseLike<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let done = false;
    const cancel = (): void => settle(false, abortError(signal));
    function settle(ok: boolean, value: unknown): void {
      if (done) return;
      done = true;
      signal.removeEventListener("abort", cancel);
      if (signal.aborted) reject(abortError(signal));
      else if (ok) resolve(value as T);
      else reject(value);
    }
    signal.addEventListener("abort", cancel, { once: true });
    Promise.resolve(work).then(x => settle(true, x), x => settle(false, x));
    if (signal.aborted) cancel();
  });
}
export function abortDelay(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(abortError(signal));
  return new Promise((resolve, reject) => {
    const cancel = (): void => { clearTimeout(timer); signal.removeEventListener("abort", cancel); reject(abortError(signal)); };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", cancel);
      if (signal.aborted) reject(abortError(signal)); else resolve();
    }, ms);
    signal.addEventListener("abort", cancel, { once: true });
    if (signal.aborted) cancel();
  });
}
