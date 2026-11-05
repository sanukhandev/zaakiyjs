import { getOwner, onCleanup, runWithOwner } from "@zaakiyjs/core";
import type { MotionScopeOptions } from "./types.js";

export interface RouteTransitionOptions extends MotionScopeOptions {
  readonly document?: Document;
}
export interface RouteTransitionResult { readonly animated: boolean }

/**
 * Call ONLY at Router's authorized DOM-commit boundary after guards and
 * loaders succeed. Router currently has no public commit interception hook.
 * This helper does not navigate or dispose any page owner.
 */
export async function runRouteTransition(
  commit: () => void | Promise<void>,
  options: RouteTransitionOptions = {}
): Promise<RouteTransitionResult> {
  if (options.signal?.aborted) throw new Error("Route transition aborted before commit");
  const doc = options.document ?? (typeof document !== "undefined" ? document : undefined);
  const media = typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : null;
  const reduce = options.reducedMotion === "disable" ||
    ((options.reducedMotion ?? "respect") !== "force" && !!media?.matches);
  if (reduce || typeof doc?.startViewTransition !== "function") {
    await commit();
    return { animated: false };
  }
  const transition = doc.startViewTransition(async () => {
    if (options.signal?.aborted) throw new Error("Route transition aborted before commit");
    await commit();
  });
  const owner = options.owner ?? getOwner();
  let releaseOwner: (() => void) | null = null;
  if (owner) {
    const cell: { stop: (() => void) | null } = { stop: () => transition.skipTransition() };
    runWithOwner(owner, () => onCleanup(() => cell.stop?.()));
    releaseOwner = () => { cell.stop = null; };
  }
  const abort = (): void => transition.skipTransition();
  options.signal?.addEventListener("abort", abort, { once: true });
  try {
    // A failed commit propagates; animation never reports false navigation success.
    await transition.updateCallbackDone;
    await transition.finished.catch(() => undefined);
    return { animated: true };
  } catch (error) {
    transition.skipTransition();
    throw error;
  } finally {
    options.signal?.removeEventListener("abort", abort);
    releaseOwner?.();
  }
}
