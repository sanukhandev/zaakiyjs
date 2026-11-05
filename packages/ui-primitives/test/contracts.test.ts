// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createOwner, disposeOwner } from "@zaakiyjs/core";
import { flushSync, signal } from "@zaakiyjs/signals";
import {
  createFocusScope, createOverlayManager, createRovingFocus, createPortal,
  createDismissableLayer, createOverlayController, createPopover, createDialog, createListbox
} from "../src/index.js";

function fixture() {
  const owner = createOwner();
  const root = document.createElement("main");
  const host = document.createElement("div");
  document.body.append(root, host);
  const overlays = createOverlayManager({ owner, root, host });
  return { owner, root, host, overlays };
}
afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });

describe("P2 Contract 09 compatibility and regressions", () => {
  it("exposes owner/element metadata and trapFocus contract spelling", () => {
    const f = fixture();
    const scopeElement = document.createElement("section");
    const first = document.createElement("button");
    const last = document.createElement("button");
    scopeElement.append(first, last);
    f.host.append(scopeElement);
    const scope = createFocusScope({ owner: f.owner, container: scopeElement, trapFocus: true });
    expect(scope.owner).toBe(f.owner);
    expect(scope.element).toBe(scopeElement);
    last.focus();
    scopeElement.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Tab", bubbles: true, cancelable: true
    }));
    expect(document.activeElement).toBe(first);
    disposeOwner(f.owner);
  });
  it("does not intercept arrows from unrelated nested input", () => {
    const f = fixture();
    const toolbar = document.createElement("div");
    const first = document.createElement("button");
    const second = document.createElement("button");
    const input = document.createElement("input");
    toolbar.append(first, second, input); f.root.append(toolbar);
    const roving = createRovingFocus({ owner: f.owner, container: toolbar });
    roving.register({ id: "first", element: first });
    roving.register({ id: "second", element: second });
    first.focus();
    const unrelated = new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true });
    input.dispatchEvent(unrelated);
    expect(unrelated.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(first);
    const owned = new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true });
    first.dispatchEvent(owned);
    expect(owned.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(second);
    disposeOwner(f.owner);
  });
  it("accepts contract items() and loop options", () => {
    const f = fixture();
    const toolbar = document.createElement("div");
    const a = document.createElement("button"), b = document.createElement("button");
    a.id = "a"; b.id = "b"; toolbar.append(a, b); f.root.append(toolbar);
    const roving = createRovingFocus({ owner: f.owner, container: toolbar, items: () => [a, b], loop: false });
    expect(roving.items()).toHaveLength(2);
    expect(roving.owner).toBe(f.owner);
    b.focus();
    b.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(b);
    disposeOwner(f.owner);
  });
  it("returns portal owner, nodes and host without changing their logical owner", () => {
    const f = fixture();
    const fragment = document.createDocumentFragment();
    const node = document.createElement("span");
    const portal = createPortal({ host: fragment, nodes: [node], owner: f.owner });
    expect(portal.owner).toBe(f.owner);
    expect(portal.host).toBe(fragment);
    expect(portal.nodes).toEqual([node]);
    portal.dispose(); portal.dispose();
    expect(node.parentNode).toBeNull();
    disposeOwner(f.owner);
  });
  it("releases portal nodes after the connected host is externally removed", async () => {
    const f = fixture();
    const child = document.createElement("button");
    const portal = createPortal({ host: f.host, nodes: [child], owner: f.owner });
    f.host.remove();
    await Promise.resolve();
    expect(child.parentNode).toBeNull();
    portal.dispose();
    disposeOwner(f.owner);
  });
  it("reports dismiss reasons using the contract's typed InteractionDetail", () => {
    const f = fixture();
    const element = document.createElement("section");
    f.host.append(element);
    const onDismiss = vi.fn();
    const layer = createDismissableLayer({ owner: f.owner, element, overlays: f.overlays, onDismiss });
    expect(layer.element).toBe(element);
    element.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    expect(onDismiss).toHaveBeenCalledWith(expect.objectContaining({ reason: "dismiss" }));
    layer.dispose(); disposeOwner(f.owner);
  });
  it("controlled overlays request changes and never change an external signal", () => {
    const f = fixture();
    const panel = document.createElement("section"); f.host.append(panel);
    const opened = signal(false);
    const onChange = vi.fn(), onDismiss = vi.fn();
    const controller = createOverlayController({
      owner: f.owner, element: panel, overlays: f.overlays,
      onDismiss, open: { value: opened, onValueChange: onChange }
    });
    controller.setOpen(true, { reason: "keyboard" });
    expect(onChange).toHaveBeenCalledWith(true, { reason: "keyboard" });
    expect(opened.value).toBe(false);
    opened.value = true; flushSync();
    expect(panel.hidden).toBe(false);
    panel.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(false, expect.objectContaining({ reason: "dismiss" }));
    expect(opened.value).toBe(true);
    disposeOwner(f.owner);
  });
  it("pointerdown on a popover trigger must not dismiss before its click toggles closed", () => {
    const f = fixture();
    const trigger = document.createElement("button");
    const content = document.createElement("div"); content.id = "popover";
    f.root.append(trigger); f.host.append(content);
    const popup = createPopover({ owner: f.owner, trigger, content, overlays: f.overlays });
    trigger.click(); flushSync();
    expect(content.hidden).toBe(false);
    trigger.dispatchEvent(new Event("pointerdown", { bubbles: true, composed: true }));
    expect(popup.open.value).toBe(true);
    trigger.click(); flushSync();
    expect(content.hidden).toBe(true);
    disposeOwner(f.owner);
  });
});

describe("modal resource locks, detached overlays and readonly state", () => {
  it("reference-counts inert and scroll locks across application managers", () => {
    const first = fixture();
    const second = fixture();
    const a = document.createElement("section"), b = document.createElement("section");
    first.host.append(a); second.host.append(b);
    document.documentElement.style.setProperty("overflow", "auto", "important");
    const one = first.overlays.add({ element: a, modal: true });
    const two = second.overlays.add({ element: b, modal: true });
    expect(document.documentElement.style.getPropertyValue("overflow")).toBe("hidden");
    one.dispose();
    expect(document.documentElement.style.getPropertyValue("overflow")).toBe("hidden");
    two.dispose();
    expect(document.documentElement.style.getPropertyValue("overflow")).toBe("auto");
    expect(document.documentElement.style.getPropertyPriority("overflow")).toBe("important");
    disposeOwner(first.owner); disposeOwner(second.owner);
    document.documentElement.style.removeProperty("overflow");
  });

  it("releases inertness and scroll locks when one active modal node is removed", async () => {
    const f = fixture();
    const modal = document.createElement("section");
    f.host.append(modal);
    const handle = f.overlays.add({ element: modal, modal: true });
    expect(f.root.hasAttribute("inert")).toBe(true);
    expect(document.documentElement.style.overflow).toBe("hidden");
    modal.remove();
    await Promise.resolve();
    expect(f.overlays.top()).toBeNull();
    expect(f.root.hasAttribute("inert")).toBe(false);
    expect(document.documentElement.style.overflow).not.toBe("hidden");
    handle.dispose();
    disposeOwner(f.owner);
  });

  it("does not mutate inaccessible dialogs attached outside the explicit host", () => {
    const f = fixture();
    const element = document.createElement("section");
    f.root.append(element);
    expect(() => createDialog({
      owner: f.owner, element, overlays: f.overlays,
      ariaLabel: "Should never attach", defaultOpen: true
    })).toThrow(/host/);
    expect(element.hasAttribute("role")).toBe(false);
    expect(element.hasAttribute("aria-modal")).toBe(false);
    disposeOwner(f.owner);
  });

  it("lets consumers cancel Escape dismissal before the layer mutates state", () => {
    const f = fixture();
    const modal = document.createElement("section"); f.host.append(modal);
    const onDismiss = vi.fn();
    const layer = f.overlays.add({
      element: modal, dismissOnEscape: true, onDismiss,
      onEscapeKeyDown: event => event.preventDefault()
    });
    const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    modal.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(onDismiss).not.toHaveBeenCalled();
    layer.dispose(); disposeOwner(f.owner);
  });

  it("supports readonly listbox activation without selection mutation", () => {
    const f = fixture();
    const list = document.createElement("div"), option = document.createElement("div");
    option.id = "ro-option"; list.append(option); f.root.append(list);
    const cb = vi.fn();
    const controller = createListbox({
      owner: f.owner, element: list, readonly: true, onSelectionChange: cb
    });
    controller.register({ id: "ro-option", element: option });
    list.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    option.click(); flushSync();
    expect(controller.selected.value).toBeNull();
    expect(cb).not.toHaveBeenCalled();
    disposeOwner(f.owner);
  });
});

describe("owner-scoped overlay manager lookup", () => {
  it("resolves the nearest Core provider for a nested owner", () => {
    const f = fixture();
    const childOwner = createOwner(f.owner);
    const panel = document.createElement("section"); f.host.append(panel);
    const onDismiss = vi.fn();
    const layer = createDismissableLayer({ owner: childOwner, element: panel, onDismiss });
    expect(layer.owner).toBe(childOwner);
    expect(f.overlays.top()).toBe(panel);
    disposeOwner(childOwner);
    expect(f.overlays.top()).toBeNull();
    disposeOwner(f.owner);
  });
  it("does not look up an overlay manager from a separate application root", () => {
    const outsideOwner = createOwner();
    const panel = document.createElement("section");
    document.body.append(panel);
    expect(() => createDismissableLayer({
      owner: outsideOwner, element: panel, onDismiss: vi.fn()
    })).toThrow(/overlay manager/);
    disposeOwner(outsideOwner);
  });
});
