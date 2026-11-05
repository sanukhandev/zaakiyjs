import { getOwner, onCleanup, runWithOwner } from "@zaakiyjs/core";
import type { OwnerScope } from "@zaakiyjs/core";
import { animateElement } from "./animate.js";
import type { ElementAnimationOptions, MotionHandle } from "./types.js";

export type PresenceState = "not-present" | "entering" | "present" | "exiting" | "disposed";
export interface PresenceOptions {
  readonly owner?: OwnerScope;
  readonly initialPresent?: boolean;
  readonly enter?: Omit<ElementAnimationOptions, "owner">;
  readonly exit?: Omit<ElementAnimationOptions, "owner">;
  /** This is a caller-owned DOM removal hook, NOT automatic node/owner disposal. */
  readonly onExited?: () => void;
}
export interface PresenceController {
  readonly state: PresenceState;
  setPresent(value: boolean): void;
  dispose(): void;
}

/** Standalone element controller. Conditional-region removal needs a separate public DOM hook. */
export function createPresence(element: Element, options: PresenceOptions = {}): PresenceController {
  let state: PresenceState = options.initialPresent === false ? "not-present" : "present";
  let generation = 0;
  let active: MotionHandle | null = null;
  let pendingFrame: number | null = null;
  const owner = options.owner ?? getOwner();

  const cancel = (): void => {
    generation++;
    if (pendingFrame !== null) {
      cancelAnimationFrame(pendingFrame);
      pendingFrame = null;
    }
    active?.cancel("superseded");
    active = null;
  };
  const controller: PresenceController = {
    get state() { return state; },
    setPresent(present) {
      if (state === "disposed") return;
      if (present && (state === "present" || state === "entering")) return;
      if (!present && (state === "not-present" || state === "exiting")) return;
      cancel();
      const run = generation;
      state = present ? "entering" : "exiting";
      const effect = present ? options.enter : options.exit;
      const complete = (): void => {
        if (generation !== run || state === "disposed") return;
        active = null;
        state = present ? "present" : "not-present";
        if (!present) options.onExited?.();
      };
      if (!effect) { complete(); return; }

      const start = (): void => {
        pendingFrame = null;
        if (generation !== run || state === "disposed") return;
        if (!element.isConnected) {
          // Do not keep an owner alive for a detached node.
          complete();
          return;
        }
        active = animateElement(element, effect);
        void active.finished.then(complete, complete);
      };
      if (present && !element.isConnected && typeof requestAnimationFrame === "function") {
        // One frame permits compiler-owned insertion; never poll indefinitely.
        pendingFrame = requestAnimationFrame(start);
      } else start();
    },
    dispose() {
      if (state === "disposed") return;
      cancel();
      state = "disposed";
    }
  };
  if (owner) {
    const cell: { close: (() => void) | null } = { close: () => controller.dispose() };
    runWithOwner(owner, () => onCleanup(() => cell.close?.()));
    // The Core owner retains only a mutable cell, not a new ownership tree.
  }
  return controller;
}
