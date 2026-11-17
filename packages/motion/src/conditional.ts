/** Additive Motion adapter for DOM's reviewed opt-in conditional exit hook. */
import { onMount, runWithOwner } from "@zaakiyjs/core";
import type { OwnerScope } from "@zaakiyjs/core";
import type { BindingHandle } from "@zaakiyjs/dom";
import { bindExitAwareConditionalRegion } from "@zaakiyjs/dom/compiler";
import type { DomRegion, ExitAwareConditionalOptions } from "@zaakiyjs/dom/compiler";
import { animateElement } from "./animate.js";
import type { ElementAnimationOptions } from "./types.js";

export interface AnimatedConditionalRegionOptions extends ExitAwareConditionalOptions {
  /** Starts after the native element is mounted, never during detached construction. */
  readonly enter?: Omit<ElementAnimationOptions, "owner" | "signal">;
  /** An exit is cancellable by the owning region's AbortSignal. */
  readonly exit: Omit<ElementAnimationOptions, "owner" | "signal">;
}

/**
 * Bind a fine-grained reactive conditional region to native WAAPI Motion.
 * Retain the existing owner and DOM node through bounded exit; re-entry aborts
 * stale animations without replacing the focused node. No global timers,
 * DOM interpreter, or compiler ABI change is required by this optional bridge.
 */
export function bindAnimatedConditionalRegion(
  owner: OwnerScope,
  region: DomRegion,
  when: () => boolean,
  create: (child: OwnerScope) => Element,
  options: AnimatedConditionalRegionOptions
): BindingHandle {
  if (!options || !options.exit || typeof options.exit !== "object") {
    throw new TypeError("Motion conditional region requires exit animation options");
  }
  return bindExitAwareConditionalRegion(
    owner, region, when,
    child => {
      const element = create(child);
      const enter = options.enter;
      if (enter) {
        runWithOwner(child, () => onMount(() => {
          const animation = animateElement(element, { ...enter, owner: child });
          // Completion is always settled; dispose WAAPI fill/timeline ownership.
          void animation.finished.then(
            () => animation.dispose(),
            () => animation.dispose()
          );
        }));
      }
      return element;
    },
    (element, signal) => {
      const animation = animateElement(element, { ...options.exit, signal });
      return animation.finished.then(outcome => {
        if (outcome.status === "failed")
          throw outcome.error ?? new Error("Motion exit animation failed");
      }).finally(() => animation.dispose());
    },
    { maxExitMs: options.maxExitMs, onExitError: options.onExitError }
  );
}
