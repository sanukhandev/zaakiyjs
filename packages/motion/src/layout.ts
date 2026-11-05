import { animateElement } from "./animate.js";
import type { AnimationHandle, MotionScopeOptions } from "./types.js";

export interface LayoutOptions extends MotionScopeOptions {
  readonly duration?: number;
  readonly easing?: string;
}
export type LayoutSnapshot = ReadonlyMap<Element, DOMRectReadOnly>;

export function captureLayout(elements: Iterable<Element>): LayoutSnapshot {
  const result = new Map<Element, DOMRectReadOnly>();
  for (const element of elements) {
    if (element.isConnected) result.set(element, element.getBoundingClientRect());
  }
  return result;
}

/** FLIP translation uses the independent CSS translate property, preserving transform. */
export function animateLayout(element: Element, previous: DOMRectReadOnly, options: LayoutOptions = {}): AnimationHandle {
  const next = element.getBoundingClientRect();
  const x = previous.left - next.left;
  const y = previous.top - next.top;
  return animateElement(element, {
    ...options,
    duration: Math.abs(x) + Math.abs(y) < 0.5 ? 0 : (options.duration ?? 200),
    keyframes: [{ translate: x + "px " + y + "px" }, { translate: "0px 0px" }]
  });
}

/** Supply a pre-reorder snapshot and the same retained DOM elements after reorder. */
export function animateKeyedMoves(previous: LayoutSnapshot, options: LayoutOptions = {}): ReadonlyMap<Element, AnimationHandle> {
  const result = new Map<Element, AnimationHandle>();
  for (const [element, oldRect] of previous) {
    if (element.isConnected) result.set(element, animateLayout(element, oldRect, options));
  }
  return result;
}
