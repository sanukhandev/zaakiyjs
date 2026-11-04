/** Explicit opt-in browser helpers. No imports from build-time code or global patches. */
export interface OwnedAbortSignal {
  readonly signal: AbortSignal;
  /** Idempotent; detaches upstream listeners. Does not abort the caller's signal. */
  dispose(): void;
}
function abortReason(signal: AbortSignal): unknown {
  return "reason" in signal && signal.reason !== undefined
    ? signal.reason : new DOMException("The operation was aborted.", "AbortError");
}
/** Native AbortController is a prerequisite. Handles already-aborted inputs and disposes listeners. */
export function composeAbortSignals(signals: readonly AbortSignal[]): OwnedAbortSignal {
  const controller = new AbortController();
  const cleanups: Array<() => void> = [];
  let disposed = false;
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    for (const cleanup of cleanups.splice(0)) cleanup();
  };
  for (const signal of signals) {
    if (controller.signal.aborted) break;
    if (signal.aborted) {
      controller.abort(abortReason(signal));
      break;
    }
    const onAbort = (): void => {
      controller.abort(abortReason(signal));
      dispose();
    };
    signal.addEventListener("abort", onAbort, { once: true });
    cleanups.push(() => signal.removeEventListener("abort", onAbort));
    // Account for an abort between the initial check and listener registration.
    if (signal.aborted) onAbort();
  }
  if (controller.signal.aborted) dispose();
  return { signal: controller.signal, dispose };
}
/**
 * Scoped wall-clock fallback, NOT a transparent AbortSignal.timeout polyfill:
 * native timeout pauses in inactive documents, but a regular timer may not.
 * Consumers must dispose when their owner/scope ends.
 */
export function scopedTimeoutSignal(milliseconds: number, parent?: AbortSignal): OwnedAbortSignal {
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 0 || milliseconds > 2_147_483_647) {
    throw new RangeError("Timeout must be an integer between 0 and 2147483647 milliseconds.");
  }
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let detached = false;
  const onAbort = (): void => { controller.abort(parent ? abortReason(parent) : undefined); dispose(); };
  function dispose(): void {
    if (detached) return;
    detached = true;
    if (timer !== undefined) clearTimeout(timer);
    parent?.removeEventListener("abort", onAbort);
  }
  if (parent?.aborted) controller.abort(abortReason(parent));
  else {
    parent?.addEventListener("abort", onAbort, { once: true });
    timer = setTimeout(() => {
      controller.abort(new DOMException("The operation timed out.", "TimeoutError"));
      dispose();
    }, milliseconds);
    if (parent?.aborted) onAbort();
  }
  return { signal: controller.signal, dispose };
}
