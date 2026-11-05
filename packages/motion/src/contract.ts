import { onCleanup, runWithOwner } from "@zaakiyjs/core";
import type { ReadonlySignal } from "@zaakiyjs/core";
import { signal } from "@zaakiyjs/signals";
import { createControlledHandle, finite } from "./lifecycle.js";
import type {
  MotionEndReason, MotionHandle, MotionOptions, MotionPhase, MotionReason,
  MotionResult, PresenceController, PresenceOptions, PresencePhase
} from "./types.js";

function mappedReason(reason: MotionReason | undefined, status: "finished" | "cancelled" | "failed" | "skipped"): MotionEndReason {
  if (reason === "owner-disposed") return "owner-disposed";
  if (reason === "superseded") return "superseded";
  if (reason === "reduced-motion") return "reduced-motion";
  if (reason === "unsupported") return "unsupported";
  return status === "finished" ? "completed" : "aborted";
}

/**
 * Frozen P2 Contract 11. WAAPI updates real DOM, no virtual DOM or global patches.
 * A settled result is a value (not a rejected cancellation Promise).
 */
export function animateOwned(options: MotionOptions): MotionHandle {
  if (!options.element || typeof options.element.animate !== "function" &&
      typeof options.element.nodeType !== "number") {
    throw new TypeError("animateOwned requires a real native Element");
  }
  if (typeof options.timing.duration === "number") finite(options.timing.duration, "duration");
  if (typeof options.timing.delay === "number") finite(options.timing.delay, "delay");
  if (typeof options.timing.iterations === "number") finite(options.timing.iterations, "iterations");

  const phase = signal<MotionPhase>("idle");
  const control = createControlledHandle({
    owner: options.owner,
    signal: options.signal,
    reducedMotion: options.reducedMotion === "always" ? "disable" :
      options.reducedMotion === "never" ? "force" : "respect"
  });
  let override: MotionEndReason | null = null;
  const finished: Promise<MotionResult> = control.handle.finished.then(outcome => {
    const resultPhase = outcome.status === "cancelled" || outcome.status === "failed" ? "cancelled" : "finished";
    phase.value = resultPhase;
    return {
      phase: resultPhase,
      reason: override ?? mappedReason(outcome.reason, outcome.status)
    };
  });
  const handle: MotionHandle = {
    phase: phase as ReadonlySignal<MotionPhase>,
    finished,
    cancel(reason: MotionEndReason = "aborted") {
      override = reason;
      control.handle.cancel(reason === "superseded" ? "superseded" :
        reason === "owner-disposed" ? "owner-disposed" : "explicit");
    },
    dispose() {
      if (control.handle.status !== "disposed" && control.handle.status !== "cancelled" &&
          control.handle.status !== "finished" && control.handle.status !== "failed" &&
          control.handle.status !== "skipped") {
        override = "aborted";
        control.handle.dispose();
      }
    }
  };
  if (control.handle.status !== "idle") return handle;
  if (control.reduced) {
    control.settle({ status: "skipped", reason: "reduced-motion" });
    return handle;
  }
  if (typeof options.element.animate !== "function") {
    control.settle({ status: "skipped", reason: "unsupported" });
    return handle;
  }
  let animation: Animation;
  try {
    animation = options.element.animate(options.keyframes, options.timing);
  } catch {
    control.settle({ status: "failed", reason: "error" });
    return handle;
  }
  control.start({
    stop: () => animation.cancel(),
    finish: () => animation.finish(),
    pause: () => animation.pause(),
    resume: () => animation.play()
  });
  phase.value = "running";
  void animation.finished.then(
    () => control.settle({ status: "finished" }),
    () => {
      if (control.handle.status === "running" || control.handle.status === "paused") {
        control.settle({ status: "cancelled", reason: "signal" });
      }
    }
  );
  return handle;
}

/**
 * Imperative visual presence only. The DOM region ABI currently cannot defer
 * conditional/keyed teardown: never remove or dispose the owning node here.
 */
export function createPresence(options: PresenceOptions): PresenceController {
  let disposed = false;
  let generation = 0;
  let current: MotionHandle | null = null;
  const phase = signal<PresencePhase>("exited");
  const empty = { keyframes: [] as Keyframe[], timing: { duration: 0 } as KeyframeAnimationOptions };
  const start = (kind: "enter" | "exit", signal?: AbortSignal): MotionHandle => {
    if (disposed || options.owner.disposed) throw new Error("Presence controller is disposed");
    const revision = ++generation;
    current?.cancel("superseded");
    phase.value = kind === "enter" ? "entering" : "exiting";
    const animation = options[kind] ?? empty;
    const handle = animateOwned({
      owner: options.owner,
      element: options.element,
      keyframes: animation.keyframes,
      timing: animation.timing,
      reducedMotion: options.reducedMotion,
      signal
    });
    current = handle;
    void handle.finished.then(() => {
      if (disposed || revision !== generation) return;
      current = null;
      phase.value = kind === "enter" ? "present" : "exited";
    });
    return handle;
  };
  const controller: PresenceController = {
    phase: phase as ReadonlySignal<PresencePhase>,
    enter() { return start("enter"); },
    exit(signal) { return start("exit", signal).finished; },
    dispose() {
      if (disposed) return;
      disposed = true;
      generation++;
      current?.cancel("owner-disposed");
      current = null;
      phase.value = "exited";
      releaseOwner?.();
      releaseOwner = null;
    }
  };
  let releaseOwner: (() => void) | null = null;
  const cell: { callback: (() => void) | null } = { callback: () => controller.dispose() };
  runWithOwner(options.owner, () => onCleanup(() => cell.callback?.()));
  releaseOwner = () => { cell.callback = null; };
  return controller;
}
