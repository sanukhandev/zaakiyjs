import { animateElement } from "./animate.js";
import type { ElementAnimationOptions } from "./types.js";

export type ConditionalExitAnimationOptions = Omit<ElementAnimationOptions, "owner" | "signal">;

/**
 * Adapter for DOM's existing bindExitAwareConditionalRegion callback.
 *
 * The DOM region retains the outgoing owner and element until this promise
 * settles, and cancels through AbortSignal on reentry/parent disposal.
 * This module never imports DOM or takes ownership of the native node.
 */
export function createConditionalExitAnimation(
  options: ConditionalExitAnimationOptions
): (node: Element, signal: AbortSignal) => Promise<void> {
  if (!options || !options.keyframes) {
    throw new TypeError("Conditional exit requires explicit keyframes");
  }
  return async (node, signal): Promise<void> => {
    if (!node || node.nodeType !== 1 || !signal ||
        typeof signal.aborted !== "boolean" || typeof signal.addEventListener !== "function") {
      throw new TypeError("Conditional exit requires a native element and AbortSignal");
    }
    if (signal.aborted) return;
    const animation = animateElement(node, {
      ...options,
      signal,
      // Do not retain detached native nodes during an asynchronous exit.
      observeRemoval: true
    });
    try {
      const result = await animation.finished;
      if (result.status === "failed") {
        throw result.error ?? new Error("Conditional exit animation failed");
      }
    } finally {
      animation.dispose();
    }
  };
}
