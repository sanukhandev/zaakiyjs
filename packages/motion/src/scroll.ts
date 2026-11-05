import { getOwner, onCleanup, runWithOwner } from "@zaakiyjs/core";
import type { MotionScopeOptions } from "./types.js";

export interface ViewportOptions extends MotionScopeOptions {
  readonly root?: Element | Document | null;
  readonly rootMargin?: string;
  readonly threshold?: number | number[];
  readonly once?: boolean;
  readonly onEnter?: (entry: IntersectionObserverEntry) => void;
  readonly onLeave?: (entry: IntersectionObserverEntry) => void;
}
export interface ScrollHandle { dispose(): void }

/** No scroll listeners: IntersectionObserver is attached only while in scope. */
export function observeViewport(element: Element, options: ViewportOptions): ScrollHandle {
  let disposed = false;
  let observer: IntersectionObserver | null = null;
  let releaseAbort: (() => void) | null = null;
  if (typeof IntersectionObserver === "function") {
    observer = new IntersectionObserver(entries => {
      if (disposed || options.owner?.disposed) return;
      for (const entry of entries) {
        if (entry.isIntersecting) {
          options.onEnter?.(entry);
          if (options.once) { observer?.disconnect(); observer = null; break; }
        } else options.onLeave?.(entry);
      }
    }, {
      root: options.root ?? null,
      rootMargin: options.rootMargin,
      threshold: options.threshold
    });
    observer.observe(element);
  }
  const handle: ScrollHandle = {
    dispose() {
      if (disposed) return;
      disposed = true;
      observer?.disconnect();
      observer = null;
      releaseAbort?.();
      releaseAbort = null;
    }
  };
  const owner = options.owner ?? getOwner();
  if (owner) runWithOwner(owner, () => onCleanup(() => handle.dispose()));
  if (options.signal) {
    if (options.signal.aborted) handle.dispose();
    else {
      const abort = (): void => handle.dispose();
      options.signal.addEventListener("abort", abort, { once: true });
      releaseAbort = () => options.signal?.removeEventListener("abort", abort);
    }
  }
  return handle;
}

export interface ScrollProgressOptions extends MotionScopeOptions {
  readonly onProgress: (progress: number) => void;
  readonly root?: Window | Element;
}
/** Passive, RAF-coalesced fallback to native CSS scroll timelines. */
export function observeScrollProgress(element: Element, options: ScrollProgressOptions): ScrollHandle {
  const root = options.root ?? (typeof window !== "undefined" ? window : null);
  if (!root || typeof requestAnimationFrame !== "function") return { dispose() {} };
  let disposed = false;
  let frame: number | null = null;
  let releaseAbort: (() => void) | null = null;
  const update = (): void => {
    frame = null;
    if (disposed) return;
    const rect = element.getBoundingClientRect();
    const viewport = root instanceof Element ? root.getBoundingClientRect().height : root.innerHeight;
    const denominator = Math.max(1, viewport + rect.height);
    options.onProgress(Math.max(0, Math.min(1, (viewport - rect.top) / denominator)));
  };
  const schedule = (): void => {
    if (!disposed && frame === null) frame = requestAnimationFrame(update);
  };
  root.addEventListener("scroll", schedule, { passive: true });
  if (typeof window !== "undefined") window.addEventListener("resize", schedule, { passive: true });
  schedule();
  const handle = {
    dispose() {
      if (disposed) return;
      disposed = true;
      root.removeEventListener("scroll", schedule);
      if (typeof window !== "undefined") window.removeEventListener("resize", schedule);
      if (frame !== null) cancelAnimationFrame(frame);
      releaseAbort?.();
      releaseAbort = null;
    }
  };
  const owner = options.owner ?? getOwner();
  if (owner) runWithOwner(owner, () => onCleanup(() => handle.dispose()));
  if (options.signal) {
    if (options.signal.aborted) handle.dispose();
    else {
      const abort = (): void => handle.dispose();
      options.signal.addEventListener("abort", abort, { once: true });
      releaseAbort = () => options.signal?.removeEventListener("abort", abort);
    }
  }
  return handle;
}
