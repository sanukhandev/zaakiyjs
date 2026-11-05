import { getOwner, onCleanup, runWithOwner } from "@zaakiyjs/core";
import type { MotionScopeOptions } from "./types.js";

export interface GestureEvent {
  readonly pointerType: string;
  readonly x: number;
  readonly y: number;
  readonly dx: number;
  readonly dy: number;
  readonly velocityX: number;
  readonly velocityY: number;
}
export interface GestureOptions extends MotionScopeOptions {
  readonly disabled?: boolean;
  readonly axis?: "x" | "y" | "both";
  readonly dragThreshold?: number;
  readonly swipeDistance?: number;
  readonly swipeVelocity?: number;
  readonly longPressMs?: number;
  readonly preventScroll?: boolean;
  readonly onTap?: (event: GestureEvent) => void;
  readonly onLongPress?: (event: GestureEvent) => void;
  readonly onDrag?: (event: GestureEvent) => void;
  readonly onSwipe?: (event: GestureEvent) => void;
  /** Keyboard alternative for essential pointer actions. */
  readonly onKeyActivate?: () => void;
}
export interface GestureController { dispose(): void }

/** Element-local pointer capture: no permanent document handlers. */
export function createGestures(element: Element, options: GestureOptions): GestureController {
  const threshold = Math.max(0, options.dragThreshold ?? 6);
  const swipeDistance = Math.max(0, options.swipeDistance ?? 32);
  const swipeVelocity = Math.max(0, options.swipeVelocity ?? 0.2);
  const longPress = Math.max(0, options.longPressMs ?? 500);
  let pointer: number | null = null;
  let startX = 0, startY = 0, startTime = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let dragged = false, held = false, disposed = false;
  let releaseAbort: (() => void) | null = null;
  const clear = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    if (pointer !== null && element.hasPointerCapture?.(pointer)) {
      try { element.releasePointerCapture(pointer); } catch { /* element detached */ }
    }
    pointer = null;
  };
  const snapshot = (event: PointerEvent): GestureEvent => {
    const dx = event.clientX - startX, dy = event.clientY - startY;
    const dt = Math.max(1, event.timeStamp - startTime);
    return {
      pointerType: event.pointerType, x: event.clientX, y: event.clientY,
      dx, dy, velocityX: dx / dt, velocityY: dy / dt
    };
  };
  const down = (event: Event): void => {
    const e = event as PointerEvent;
    if (disposed || options.disabled || pointer !== null || (e.pointerType === "mouse" && e.button !== 0)) return;
    pointer = e.pointerId;
    startX = e.clientX; startY = e.clientY;
    startTime = e.timeStamp;
    dragged = held = false;
    try { element.setPointerCapture?.(pointer); } catch { /* disconnected */ }
    if (options.onLongPress) timer = setTimeout(() => {
      if (pointer === e.pointerId && !dragged && !disposed) {
        held = true;
        options.onLongPress?.(snapshot(e));
      }
    }, longPress);
  };
  const move = (event: Event): void => {
    const e = event as PointerEvent;
    if (disposed || e.pointerId !== pointer) return;
    const dx = e.clientX - startX, dy = e.clientY - startY;
    const projected = options.axis === "x" ? Math.abs(dx) :
      options.axis === "y" ? Math.abs(dy) : Math.hypot(dx, dy);
    if (projected >= threshold) dragged = true;
    if (dragged) {
      if (timer !== null) { clearTimeout(timer); timer = null; }
      if (options.preventScroll && e.cancelable) e.preventDefault();
      options.onDrag?.(snapshot(e));
    }
  };
  const up = (event: Event): void => {
    const e = event as PointerEvent;
    if (disposed || e.pointerId !== pointer) return;
    const value = snapshot(e);
    clear();
    const distance = options.axis === "x" ? Math.abs(value.dx) :
      options.axis === "y" ? Math.abs(value.dy) : Math.hypot(value.dx, value.dy);
    const velocity = options.axis === "x" ? Math.abs(value.velocityX) :
      options.axis === "y" ? Math.abs(value.velocityY) : Math.hypot(value.velocityX, value.velocityY);
    if (dragged && distance >= swipeDistance && velocity >= swipeVelocity) options.onSwipe?.(value);
    else if (!dragged && !held) options.onTap?.(value);
  };
  const key = (event: Event): void => {
    const e = event as KeyboardEvent;
    if (disposed || options.disabled || !options.onKeyActivate) return;
    if (e.key === "Enter" || e.key === " ") {
      if (e.key === " " && e.cancelable) e.preventDefault();
      options.onKeyActivate();
    }
  };
  element.addEventListener("pointerdown", down);
  element.addEventListener("pointermove", move);
  element.addEventListener("pointerup", up);
  element.addEventListener("pointercancel", clear);
  element.addEventListener("lostpointercapture", clear);
  element.addEventListener("keydown", key);
  const controller = {
    dispose() {
      if (disposed) return;
      disposed = true;
      clear();
      element.removeEventListener("pointerdown", down);
      element.removeEventListener("pointermove", move);
      element.removeEventListener("pointerup", up);
      element.removeEventListener("pointercancel", clear);
      element.removeEventListener("lostpointercapture", clear);
      element.removeEventListener("keydown", key);
      releaseAbort?.();
      releaseAbort = null;
    }
  };
  const owner = options.owner ?? getOwner();
  if (owner) runWithOwner(owner, () => onCleanup(() => controller.dispose()));
  if (options.signal) {
    if (options.signal.aborted) controller.dispose();
    else {
      const abort = (): void => controller.dispose();
      options.signal.addEventListener("abort", abort, { once: true });
      releaseAbort = () => options.signal?.removeEventListener("abort", abort);
    }
  }
  return controller;
}
