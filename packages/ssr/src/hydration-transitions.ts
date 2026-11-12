/**
 * H5 opt-in navigation transaction guard for hydration work.
 * A transaction is never allowed to commit after it is superseded.
 * No global router/timer/Promise patching.
 */
export interface HydrationTransition {
  readonly routeId: string;
  readonly signal: AbortSignal;
  readonly current: boolean;
  /** Execute only while this transaction remains current and not aborted. */
  commit<T>(action: () => T): T;
  abort(reason?: unknown): void;
}
export interface HydrationTransitionCoordinator {
  start(routeId: string, externalSignal?: AbortSignal): HydrationTransition;
  dispose(): void;
}
const ROUTE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,199}$/;

export function createHydrationTransitionCoordinator(): HydrationTransitionCoordinator {
  let active: AbortController | undefined;
  let removeExternal: (() => void) | undefined;
  let disposed = false;
  let generation = 0;

  return {
    start(routeId, externalSignal) {
      if (disposed) throw new Error("Hydration coordinator disposed");
      if (!ROUTE.test(routeId)) throw new TypeError("Unsafe hydration route ID");
      if (externalSignal !== undefined &&
          (!externalSignal || typeof externalSignal.addEventListener !== "function" ||
           typeof externalSignal.aborted !== "boolean"))
        throw new TypeError("Invalid navigation abort signal");
      // Establish a new generation before firing abort callbacks, so previous
      // listeners cannot reenter and commit an obsolete transaction.
      const currentGeneration = ++generation;
      const previous = active;
      removeExternal?.();
      removeExternal = undefined;
      const controller = new AbortController();
      active = controller;
      previous?.abort(new Error("Hydration navigation superseded"));
      if (active !== controller || disposed || controller.signal.aborted) {
        controller.abort(new Error("Hydration transition superseded during activation"));
      }
      if (externalSignal && active === controller && !controller.signal.aborted) {
        const cancel = () => controller.abort(externalSignal.reason);
        if (externalSignal.aborted) cancel();
        else {
          externalSignal.addEventListener("abort", cancel, { once: true });
          removeExternal = () => externalSignal.removeEventListener("abort", cancel);
        }
      }
      const isCurrent = () =>
        !disposed && active === controller && generation === currentGeneration &&
        !controller.signal.aborted;
      return {
        routeId,
        signal: controller.signal,
        get current() { return isCurrent(); },
        commit<T>(action: () => T): T {
          if (typeof action !== "function") throw new TypeError("Expected hydration commit function");
          if (!isCurrent()) throw new Error("Stale or aborted hydration transaction");
          // Synchronous only: callers must recheck after awaited work.
          return action();
        },
        abort(reason?: unknown) {
          controller.abort(reason);
          if (active === controller) {
            removeExternal?.();
            removeExternal = undefined;
            active = undefined;
          }
        }
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      ++generation;
      removeExternal?.();
      removeExternal = undefined;
      const previous = active;
      active = undefined;
      previous?.abort(new Error("Hydration coordinator disposed"));
    }
  };
}
