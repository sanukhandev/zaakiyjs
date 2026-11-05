import { createControlledHandle, finite } from "./lifecycle.js";
import type { ElementAnimationOptions, AnimationHandle } from "./types.js";

export function animateElement(element: Element, options: ElementAnimationOptions): AnimationHandle {
  const duration = finite(options.duration ?? 200, "duration");
  const delay = finite(options.delay ?? 0, "delay");
  const endDelay = finite(options.endDelay ?? 0, "endDelay");
  const iterations = finite(options.iterations ?? 1, "iterations");
  if (iterations === 0) throw new RangeError("iterations must be greater than zero");
  if (!element || typeof element !== "object") throw new TypeError("A real DOM element is required");
  const control = createControlledHandle(options);
  if (control.handle.status !== "idle") return control.handle;

  if (control.reduced || duration === 0) {
    control.settle({ status: "skipped", reason: "reduced-motion" });
    return control.handle;
  }
  if (typeof element.animate !== "function") {
    control.settle({ status: "skipped", reason: "unsupported" });
    return control.handle;
  }

  let animation: Animation;
  try {
    animation = element.animate(options.keyframes, {
      duration: options.reducedMotion === "reduce" && typeof matchMedia === "function" &&
        matchMedia("(prefers-reduced-motion: reduce)").matches
        ? Math.min(duration, 80) : duration,
      delay, endDelay, iterations,
      easing: options.easing ?? "ease",
      fill: options.fill ?? "both",
      direction: options.direction ?? "normal"
    });
  } catch (error) {
    control.settle({ status: "failed", reason: "error", error });
    return control.handle;
  }

  let removalObserver: MutationObserver | null = null;
  if (options.observeRemoval && element.parentNode && typeof MutationObserver !== "undefined") {
    removalObserver = new MutationObserver(() => {
      if (!element.isConnected) control.handle.cancel("element-removed");
    });
    removalObserver.observe(element.parentNode, { childList: true });
  }
  const observer = removalObserver;
  control.start({
    stop: () => { observer?.disconnect(); animation.cancel(); },
    finish: () => { observer?.disconnect(); animation.finish(); },
    pause: () => animation.pause(),
    resume: () => animation.play()
  });

  // WAAPI finished rejects on cancellation. Always consume that rejection.
  void animation.finished.then(
    () => { observer?.disconnect(); control.settle({ status: "finished" }); },
    error => {
      observer?.disconnect();
      if (control.handle.status === "running" || control.handle.status === "paused") {
        control.settle({ status: "failed", reason: "error", error });
      }
    }
  );
  return control.handle;
}
