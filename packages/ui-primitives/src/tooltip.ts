import type { OwnerScope } from "@zaakiyjs/core";
import { effect } from "@zaakiyjs/signals";
import type { ReadonlySignal } from "@zaakiyjs/signals";
import { createControlledState } from "./state.js";
import { listen, own } from "./lifecycle.js";
import type { PrimitiveHandle } from "./lifecycle.js";

export interface TooltipOptions {
  readonly owner: OwnerScope;
  readonly trigger: HTMLElement;
  readonly tooltip: HTMLElement;
  readonly open?: ReadonlySignal<boolean>;
  readonly defaultOpen?: boolean;
  readonly onOpenChange?: (open: boolean) => void;
  readonly delayMs?: number;
}
export interface TooltipController extends PrimitiveHandle {
  readonly open: ReadonlySignal<boolean>;
  setOpen(open: boolean): void;
}
export function createTooltip(options: TooltipOptions): TooltipController {
  const { trigger, tooltip, owner } = options;
  if (!tooltip.id) throw new Error("Tooltip needs a stable ID");
  if (tooltip.querySelector("a, button, input, select, textarea, [tabindex]")) {
    throw new Error("Tooltips must not contain interactive descendants");
  }
  const old = {
    described: trigger.getAttribute("aria-describedby"),
    role: tooltip.getAttribute("role"), hidden: tooltip.hidden
  };
  tooltip.setAttribute("role", "tooltip");
  const parts = new Set((old.described ?? "").split(/\s+/).filter(Boolean));
  parts.add(tooltip.id);
  trigger.setAttribute("aria-describedby", [...parts].join(" "));
  const state = createControlledState({
    owner, value: options.open, defaultValue: options.defaultOpen ?? false,
    onChange: next => options.onOpenChange?.(next)
  });
  // A single owner cleanup is registered for the timer slot. Hover churn
  // must not accumulate retained owner cleanup closures indefinitely.
  let timer: ReturnType<typeof setTimeout> | null = null;
  const clearTimer = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  const setOpen = (open: boolean) => { clearTimer(); state.set(open); };
  const show = () => {
    clearTimer();
    timer = setTimeout(() => {
      timer = null;
      if (!owner.disposed) state.set(true);
    }, Math.max(0, options.delayMs ?? 500));
  };
  const hide = () => setOpen(false);
  const listeners = [
    listen(trigger, "mouseenter", show, owner),
    listen(trigger, "mouseleave", hide, owner),
    listen(trigger, "focusin", show, owner),
    listen(trigger, "focusout", hide, owner),
    listen(trigger, "keydown", (event: Event) => {
      if (event instanceof KeyboardEvent && event.key === "Escape") hide();
    }, owner)
  ];
  const render = effect(() => { tooltip.hidden = !state.value.value; }, { phase: "render" });
  const lifecycle = own(() => {
    render.dispose(); clearTimer();
    for (const listener of listeners) listener.dispose();
    if (old.described === null) trigger.removeAttribute("aria-describedby");
    else trigger.setAttribute("aria-describedby", old.described);
    if (old.role === null) tooltip.removeAttribute("role");
    else tooltip.setAttribute("role", old.role);
    tooltip.hidden = old.hidden;
  }, owner);
  return { open: state.value, setOpen, dispose: () => lifecycle.dispose() };
}
