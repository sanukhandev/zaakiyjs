/** Optional browser-native motion, with no DOM globals accessed at import time. */
export { animateElement } from "./animate.js";
export { createSpring } from "./spring.js";
export { createPresence } from "./presence.js";
export { captureLayout, animateLayout, animateKeyedMoves } from "./layout.js";
export { observeViewport, observeScrollProgress } from "./scroll.js";
export { createGestures } from "./gesture.js";
export type {
  MotionHandle, MotionOutcome, MotionReason, MotionStatus, ReducedMotionPolicy,
  MotionScopeOptions, ElementAnimationOptions, SpringOptions
} from "./types.js";
export type { PresenceController, PresenceOptions, PresenceState } from "./presence.js";
export type { LayoutOptions, LayoutSnapshot } from "./layout.js";
export type { ViewportOptions, ScrollProgressOptions, ScrollHandle } from "./scroll.js";
export type { GestureEvent, GestureOptions, GestureController } from "./gesture.js";
