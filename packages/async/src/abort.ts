import { CancellationError, ConfigurationError, TimeoutError } from "./errors.js";
export interface Cancellation {
  readonly signal: AbortSignal;
  cancel(kind?: "manual" | "owner" | "superseded", cause?: unknown): void;
  dispose(): void;
}
/** Own a native signal and link a caller signal and optional timeout without global patches. */
export function createCancellation(caller?: AbortSignal, timeoutMs?: number): Cancellation {
  if (timeoutMs !== undefined && (!Number.isFinite(timeoutMs) || timeoutMs <= 0)) {
    throw new ConfigurationError("timeoutMs must be a finite positive number");
  }
  const controller = new AbortController();
  const cancel = (kind: "manual" | "owner" | "superseded" = "manual", cause?: unknown): void => {
    if (!controller.signal.aborted) controller.abort(new CancellationError(kind, cause));
  };
  const onCallerAbort = (): void => {
    if (!controller.signal.aborted) controller.abort(new CancellationError("caller", caller?.reason));
  };
  if (caller?.aborted) onCallerAbort();
  else caller?.addEventListener("abort", onCallerAbort, { once: true });
  const timer = timeoutMs !== undefined && !controller.signal.aborted
    ? setTimeout(() => { if (!controller.signal.aborted) controller.abort(new TimeoutError()); }, timeoutMs)
    : undefined;
  return {
    signal: controller.signal,
    cancel,
    dispose() {
      caller?.removeEventListener("abort", onCallerAbort);
      if (timer !== undefined) clearTimeout(timer);
    }
  };
}
export function abortedReason(signal: AbortSignal): CancellationError {
  return signal.reason instanceof CancellationError
    ? signal.reason
    : new CancellationError("caller", signal.reason);
}
/** Settles promptly on cancellation; observes eventual promise rejection to avoid unhandled errors. */
export function awaitAbortable<T>(work: PromiseLike<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const onAbort = (): void => finish(false, abortedReason(signal));
    function finish(ok: boolean, value: unknown): void {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      if (ok && !signal.aborted) resolve(value as T);
      else reject(signal.aborted ? abortedReason(signal) : value);
    }
    signal.addEventListener("abort", onAbort, { once: true });
    Promise.resolve(work).then(value => finish(true, value), error => finish(false, error));
    if (signal.aborted) onAbort();
  });
}
export function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(abortedReason(signal));
  return new Promise<void>((resolve, reject) => {
    const onAbort = (): void => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      reject(abortedReason(signal));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      if (signal.aborted) reject(abortedReason(signal));
      else resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
}
/** Standalone composition helper; call dispose after using the returned signal. */
export function composeSignals(signals: readonly AbortSignal[], timeoutMs?: number): Cancellation {
  if (timeoutMs !== undefined && (!Number.isFinite(timeoutMs) || timeoutMs <= 0)) {
    throw new ConfigurationError("timeoutMs must be a finite positive number");
  }
  const controller = new AbortController();
  const listeners: Array<() => void> = [];
  for (const source of signals) {
    const onAbort = (): void => {
      if (!controller.signal.aborted) controller.abort(new CancellationError("caller", source.reason));
    };
    if (source.aborted) onAbort();
    else {
      source.addEventListener("abort", onAbort, { once: true });
      listeners.push(() => source.removeEventListener("abort", onAbort));
    }
  }
  const timer = timeoutMs !== undefined && !controller.signal.aborted
    ? setTimeout(() => controller.abort(new TimeoutError()), timeoutMs)
    : undefined;
  return {
    signal: controller.signal,
    cancel(kind = "manual", cause?: unknown) {
      if (!controller.signal.aborted) controller.abort(new CancellationError(kind, cause));
    },
    dispose() {
      for (const remove of listeners) remove();
      if (timer !== undefined) clearTimeout(timer);
    }
  };
}
