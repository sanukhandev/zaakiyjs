// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createOwner, disposeOwner } from "@zaakiyjs/core";
import { flushSync } from "@zaakiyjs/signals";
import { createFocusManager, createFocusScope, createOverlayManager, createDialog, focusables } from "../src/index.js";

function tree() {
  const owner = createOwner();
  const root = document.createElement("main");
  const host = document.createElement("div");
  const launch = document.createElement("button");
  launch.textContent = "Launch";
  root.append(launch);
  document.body.append(root, host);
  const overlays = createOverlayManager({ root, host, owner });
  return { owner, root, host, launch, overlays };
}
const key = (value: string, shiftKey = false) =>
  new KeyboardEvent("keydown", { key: value, shiftKey, bubbles: true, cancelable: true });
afterEach(() => document.body.replaceChildren());

describe("focus, layers, dialogs", () => {
  it("skips disabled, hidden and inert focus targets", () => {
    const root = document.createElement("div");
    const ok = document.createElement("button");
    const disabled = document.createElement("button");
    const hidden = document.createElement("button");
    const inert = document.createElement("button");
    disabled.disabled = true;
    hidden.hidden = true;
    const parent = document.createElement("div");
    parent.setAttribute("inert", "");
    parent.append(inert);
    root.append(ok, disabled, hidden, parent);
    document.body.append(root);
    expect(focusables(root)).toEqual([ok]);
  });
  it("enters focus, contains Tab and restores to the original trigger", () => {
    const f = tree();
    const dialog = document.createElement("section");
    const first = document.createElement("button"), last = document.createElement("button");
    dialog.append(first, last);
    f.host.append(dialog);
    f.launch.focus();
    const scope = createFocusScope({ container: dialog, owner: f.owner, contain: true });
    expect(document.activeElement).toBe(first);
    last.focus();
    document.dispatchEvent(key("Tab"));
    expect(document.activeElement).toBe(first);
    first.focus();
    document.dispatchEvent(key("Tab", true));
    expect(document.activeElement).toBe(last);
    scope.dispose();
    expect(document.activeElement).toBe(f.launch);
    disposeOwner(f.owner);
  });
  it("nested focus manager only contains the uppermost scope", () => {
    const f = tree();
    const manager = createFocusManager(f.owner);
    const outer = document.createElement("section"), inner = document.createElement("section");
    const a = document.createElement("button"), b = document.createElement("button");
    outer.append(a, inner); inner.append(b);
    f.host.append(outer);
    const outerScope = createFocusScope({ container: outer, owner: f.owner, manager, contain: true });
    a.focus();
    const innerScope = createFocusScope({ container: inner, owner: f.owner, manager, contain: true });
    expect(document.activeElement).toBe(b);
    innerScope.dispose();
    expect(document.activeElement).toBe(a);
    outerScope.dispose();
    disposeOwner(f.owner);
  });
  it("restores background inertness and escaped modal dismissal", () => {
    const f = tree();
    const dialog = document.createElement("div");
    dialog.id = "dialog";
    dialog.append(document.createElement("button"));
    f.host.append(dialog);
    f.launch.focus();
    const dismissed = vi.fn();
    const controller = createDialog({
      element: dialog, owner: f.owner, overlays: f.overlays,
      ariaLabel: "Account details", onOpenChange: dismissed
    });
    controller.setOpen(true); flushSync();
    expect(f.root.hasAttribute("inert")).toBe(true);
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    dialog.dispatchEvent(key("Escape"));
    flushSync();
    expect(dismissed).toHaveBeenCalledWith(false, "escape");
    expect(f.root.hasAttribute("inert")).toBe(false);
    expect(document.activeElement).toBe(f.launch);
    disposeOwner(f.owner);
  });
  it("prior inert values survive nested dialog stacking", () => {
    const f = tree();
    const permanent = document.createElement("aside");
    permanent.setAttribute("inert", "");
    document.body.append(permanent);
    const first = document.createElement("div"), second = document.createElement("div");
    f.host.append(first, second);
    const one = f.overlays.add({ element: first, modal: true });
    const two = f.overlays.add({ element: second, modal: true });
    expect(first.hasAttribute("inert")).toBe(true);
    two.dispose();
    expect(f.root.hasAttribute("inert")).toBe(true);
    one.dispose();
    expect(f.root.hasAttribute("inert")).toBe(false);
    expect(permanent.hasAttribute("inert")).toBe(true);
    disposeOwner(f.owner);
  });
  it("only topmost layer receives outside pointer and Escape dismissal", () => {
    const f = tree();
    const first = document.createElement("section"), second = document.createElement("section");
    f.host.append(first, second);
    const one = vi.fn(), two = vi.fn();
    const firstLayer = f.overlays.add({
      element: first, dismissOnEscape: true, dismissOnOutsidePointer: true,
      onDismiss: one
    });
    const secondLayer = f.overlays.add({
      element: second, dismissOnEscape: true, dismissOnOutsidePointer: true,
      onDismiss: two
    });
    f.launch.dispatchEvent(new Event("pointerdown", { bubbles: true, composed: true }));
    expect(two).toHaveBeenCalledTimes(1);
    expect(one).not.toHaveBeenCalled();
    second.dispatchEvent(key("Escape"));
    expect(two).toHaveBeenCalledTimes(2);
    secondLayer.dispose();
    first.dispatchEvent(key("Escape"));
    expect(one).toHaveBeenCalledTimes(1);
    firstLayer.dispose();
    disposeOwner(f.owner);
  });
  it("does not dispatch root A pointer events to root B listeners", () => {
    const first = tree();
    const second = tree();
    const content = document.createElement("div");
    second.host.append(content);
    const callback = vi.fn();
    second.overlays.add({
      element: content, dismissOnOutsidePointer: true, onDismiss: callback
    });
    first.launch.dispatchEvent(new Event("pointerdown", { bubbles: true, composed: true }));
    expect(callback).not.toHaveBeenCalled();
    disposeOwner(first.owner); disposeOwner(second.owner);
  });
  it("leaves no root listeners and inert residue after disposal", () => {
    const f = tree();
    const dialog = document.createElement("div");
    f.host.append(dialog);
    const onDismiss = vi.fn();
    f.overlays.add({ element: dialog, modal: true, dismissOnEscape: true, onDismiss });
    expect(f.root.hasAttribute("inert")).toBe(true);
    disposeOwner(f.owner);
    expect(f.root.hasAttribute("inert")).toBe(false);
    dialog.dispatchEvent(key("Escape"));
    expect(onDismiss).not.toHaveBeenCalled();
  });
});
