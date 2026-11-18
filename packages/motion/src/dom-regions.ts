import type { OwnerScope } from "@zaakiyjs/core";
import {
  bindExitAwareConditionalRegion,
  type DomRegion,
  type ExitAwareConditionalOptions
} from "@zaakiyjs/dom/compiler";
import { animateElement } from "./animate.js";
import type { ElementAnimationOptions } from "./types.js";

export interface MotionConditionalRegionOptions extends ExitAwareConditionalOptions {
  /** Native Web Animations API keyframes; never HTML/CSS source strings. */
  readonly exit: Omit<ElementAnimationOptions, "owner" | "signal">;
}

/**
 * Optional Motion-to-DOM bridge. Retains the *same* mounted native element
 * during an asynchronous exit; DOM owns its scope and cancels stale exits.
 *
 * Does not rewrite JSX <Show>, keyed loops, routes or portals. Call from an
 * explicit owner scope with a DomRegion produced by @zaakiyjs/dom/compiler.
 */
export function bindMotionConditionalRegion(
  owner: OwnerScope,
  region: DomRegion,
  when: () => boolean,
  create: (child: OwnerScope) => Element,
  options: MotionConditionalRegionOptions
): ReturnType<typeof bindExitAwareConditionalRegion> {
  if (!options || !options.exit || typeof options.exit !== "object") {
    throw new TypeError("Motion conditional region requires explicit exit keyframes");
  }
  const maxExitMs = options.maxExitMs ?? 5_000;
  const exit = options.exit;
  const duration = exit.duration ?? 200;
  const delay = exit.delay ?? 0;
  const endDelay = exit.endDelay ?? 0;
  const iterations = exit.iterations ?? 1;
  const worstCaseMs = delay + duration * iterations + endDelay;
  if (!Number.isFinite(worstCaseMs) || !Number.isSafeInteger(maxExitMs) ||
      worstCaseMs > maxExitMs || worstCaseMs < 0 ||
      !Number.isFinite(duration) || duration < 0 || !Number.isFinite(delay) || delay < 0 ||
      !Number.isFinite(endDelay) || endDelay < 0 ||
      !Number.isFinite(iterations) || iterations <= 0) {
    throw new RangeError("Motion exit timing exceeds the bounded DOM owner lifetime");
  }
  return bindExitAwareConditionalRegion(owner, region, when, create, (node, signal) => {
    const animation = animateElement(node, {
      ...exit,
      // The region owns the exit. Untrusted option objects cannot redirect
      // cancellation to a different scope or override its AbortSignal.
      owner,
      signal,
      observeRemoval: true
    });
    return animation.finished.then(result => {
      if (result.status === "failed") {
        throw result.error ?? new Error("Native exit animation failed");
      }
    }).finally(() => animation.dispose());
  }, {maxExitMs, onExitError: options.onExitError});
}
