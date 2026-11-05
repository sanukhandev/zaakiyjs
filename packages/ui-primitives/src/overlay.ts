import type { OwnerScope } from "@zaakiyjs/core";
import { effect } from "@zaakiyjs/signals";
import type { ReadonlySignal } from "@zaakiyjs/signals";
import { own } from "./lifecycle.js";
import type { PrimitiveHandle } from "./lifecycle.js";
import { createControlledState } from "./state.js";
import type { Controllable, ElementController, InteractionDetail } from "./contracts.js";
import { getOverlayManager } from "./layers.js";
import type { OverlayManager } from "./layers.js";

/** Explicit per-app manager is required; no implicit document-global stack. */
export interface DismissableLayerOptions {
  readonly owner: OwnerScope;
  readonly element: HTMLElement;
  readonly trigger?: HTMLElement;
  readonly modal?: boolean;
  readonly overlays?: OverlayManager;
  readonly onDismiss: (detail: InteractionDetail) => void;
}
export interface OverlayOptions extends DismissableLayerOptions {
  readonly open: Controllable<boolean>;
  readonly onEscapeKeyDown?: (event: KeyboardEvent) => void;
  readonly onPointerDownOutside?: (event: PointerEvent) => void;
}
export interface OverlayController extends ElementController {
  readonly open: ReadonlySignal<boolean>;
  setOpen(value: boolean, detail?: InteractionDetail): void;
}
export function createDismissableLayer(options: DismissableLayerOptions): ElementController {
  if (options.owner.disposed) throw new Error("Cannot attach a layer to disposed owner");
  const overlays = options.overlays ?? getOverlayManager(options.owner);
  if (!overlays) throw new Error("No overlay manager registered in the application owner tree");
  const layer = overlays.add({
    element: options.element, trigger: options.trigger, modal: options.modal,
    dismissOnEscape: true, dismissOnOutsidePointer: true,
    onDismiss: e => options.onDismiss({ reason: "dismiss", originalEvent: e.originalEvent })
  });
  // A manager can outlive a feature/component owner. Releasing that child owner
  // must still tear down every layer it registered with the application stack.
  try {
    const owned = own(() => layer.dispose(), options.owner);
    return { owner: options.owner, element: options.element, dispose: () => owned.dispose() };
  } catch (error) {
    layer.dispose();
    throw error;
  }
}
export function createOverlayController(options: OverlayOptions): OverlayController {
  const { owner, element } = options;
  const overlays = options.overlays ?? getOverlayManager(owner);
  if (!overlays) throw new Error("No overlay manager registered in the application owner tree");
  if (owner.disposed) throw new Error("Cannot attach an overlay to disposed owner");
  if (!overlays.accepts(element)) throw new Error("Overlay must belong to its application host");
  const oldHidden = element.hidden;
  const state = createControlledState({
    owner,
    value: options.open.value,
    defaultValue: options.open.defaultValue ?? false,
    onValueChange: options.open.onValueChange
  });
  let layer: PrimitiveHandle | null = null;
  const releaseLayer = () => {
    layer?.dispose();
    layer = null;
  };
  let render: PrimitiveHandle;
  try {
    render = effect(() => {
      element.hidden = !state.value.value;
      if (!state.value.value) return;
      layer = overlays.add({
        element, trigger: options.trigger, modal: options.modal,
        dismissOnEscape: true, dismissOnOutsidePointer: true,
        onEscapeKeyDown: options.onEscapeKeyDown,
        onPointerDownOutside: options.onPointerDownOutside,
        onDismiss: event => {
          const detail: InteractionDetail = { reason: "dismiss", originalEvent: event.originalEvent };
          options.onDismiss(detail);
          state.set(false, detail);
        }
      });
      return releaseLayer;
    }, { phase: "render" });
  } catch (error) {
    releaseLayer();
    element.hidden = oldHidden;
    throw error;
  }
  const cleanup = own(() => {
    render.dispose();
    releaseLayer();
    element.hidden = oldHidden;
  }, owner);
  return {
    owner, element, open: state.value,
    setOpen: (next, detail) => state.set(next, detail),
    dispose: () => cleanup.dispose()
  };
}
