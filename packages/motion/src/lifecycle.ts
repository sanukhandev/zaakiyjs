import { getOwner, onCleanup, runWithOwner } from "@zaakiyjs/core";
import type { AnimationHandle, MotionOutcome, MotionReason, MotionScopeOptions, MotionStatus } from "./types.js";

export interface Driver {
  stop?(): void;
  finish?(): void;
  pause?(): void;
  resume?(): void;
}
export interface ControlledHandle {
  readonly handle: AnimationHandle;
  readonly reduced: boolean;
  start(driver: Driver): void;
  settle(outcome: MotionOutcome): void;
}

/** One-shot completion. Cancellation and failures are values, never floating rejections. */
export function createControlledHandle(options: MotionScopeOptions = {}): ControlledHandle {
  let state: MotionStatus = "idle";
  let driver: Driver = {};
  let resolveFinished!: (outcome: MotionOutcome) => void;
  const finished = new Promise<MotionOutcome>(resolve => { resolveFinished = resolve; });
  let settled = false;
  const cleanups: Array<() => void> = [];
  const policy = options.reducedMotion ?? "respect";
  const media = policy === "respect" || policy === "reduce"
    ? (typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : null)
    : null;
  const reduced = policy === "disable" || (policy === "respect" && !!media?.matches);

  const settle = (outcome: MotionOutcome): void => {
    if (settled) return;
    settled = true;
    state = outcome.status;
    // Release WAAPI fill/timeline resources even after natural completion.
    // The application owns the element's final underlying CSS state.
    try { driver.stop?.(); } catch { /* cleanup must still settle */ }
    for (const cleanup of cleanups.splice(0)) cleanup();
    driver = {};
    resolveFinished(outcome);
  };
  const handle: AnimationHandle = {
    get finished() { return finished; },
    get status() { return state; },
    cancel(reason: MotionReason = "explicit") {
      if (settled) return;
      settle({ status: "cancelled", reason });
    },
    finish() {
      if (settled) return;
      try {
        driver.finish?.();
        settle({ status: "finished" });
      } catch (error) {
        settle({ status: "failed", reason: "error", error });
      }
    },
    pause() {
      if (settled || state !== "running") return;
      try { driver.pause?.(); state = "paused"; }
      catch (error) { settle({ status: "failed", reason: "error", error }); }
    },
    resume() {
      if (settled || state !== "paused") return;
      try { driver.resume?.(); state = "running"; }
      catch (error) { settle({ status: "failed", reason: "error", error }); }
    },
    dispose() {
      if (settled) return;
      settle({ status: "cancelled", reason: "explicit" });
      state = "disposed";
    }
  };

  const owner = options.owner ?? getOwner();
  if (owner) {
    // Core does not expose cleanup deregistration; release the heavy callback
    // on settlement so a long-lived owner does not retain completed animations.
    const cell: { current: (() => void) | null } = { current: () => handle.cancel("owner-disposed") };
    runWithOwner(owner, () => onCleanup(() => cell.current?.()));
    cleanups.push(() => { cell.current = null; });
  }
  const signal = options.signal;
  if (signal) {
    const abort = (): void => handle.cancel("signal");
    if (signal.aborted) abort();
    else {
      signal.addEventListener("abort", abort, { once: true });
      cleanups.push(() => signal.removeEventListener("abort", abort));
    }
  }
  if (media && !reduced && !settled) {
    const changed = (): void => {
      if (media.matches && !settled) {
        try { driver.finish?.(); }
        catch { /* WAAPI may already have been cancelled; settle regardless */ }
        settle({ status: "skipped", reason: "reduced-motion" });
      }
    };
    if (typeof media.addEventListener === "function") {
      media.addEventListener("change", changed);
      cleanups.push(() => media.removeEventListener("change", changed));
    }
  }
  return {
    handle,
    reduced,
    start(nextDriver) {
      if (settled) { try { nextDriver.stop?.(); } catch { /* closed */ } return; }
      driver = nextDriver;
      state = "running";
    },
    settle
  };
}

/** Validate user-defined finite animation durations and physics input. */
export function finite(value: number, label: string, min = 0): number {
  if (!Number.isFinite(value) || value < min) throw new RangeError(label + " must be finite and >= " + min);
  return value;
}
