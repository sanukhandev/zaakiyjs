// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createOwner, disposeOwner } from "@zaakiyjs/core";
import { flushSync, signal } from "@zaakiyjs/signals";
import {
  createTabs, createDisclosure, createAccordion, createRovingFocus,
  createOverlayManager, createMenu, createListbox, createTooltip, createPopover
} from "../src/index.js";

const key = (keyName: string) =>
  new KeyboardEvent("keydown", { key: keyName, bubbles: true, cancelable: true });
function fixture() {
  const owner = createOwner();
  const root = document.createElement("main"), host = document.createElement("div");
  document.body.append(root, host);
  const overlays = createOverlayManager({ root, host, owner });
  return { owner, root, host, overlays };
}
afterEach(() => document.body.replaceChildren());

describe("headless accessible patterns", () => {
  it("tabs switch on arrow keys and expose ARIA relationships", () => {
    const f = fixture(), list = document.createElement("div");
    f.root.append(list);
    const a = document.createElement("button"), b = document.createElement("button");
    const pa = document.createElement("div"), pb = document.createElement("div");
    a.id = "tab-a"; b.id = "tab-b"; pa.id = "panel-a"; pb.id = "panel-b";
    list.append(a, b); f.root.append(pa, pb);
    const tabs = createTabs({ list, owner: f.owner, defaultValue: "a" });
    tabs.register({ id: "a", tab: a, panel: pa });
    tabs.register({ id: "b", tab: b, panel: pb });
    expect(a.getAttribute("aria-controls")).toBe("panel-a");
    a.focus();
    a.dispatchEvent(key("ArrowRight"));
    flushSync();
    expect(tabs.selected.value).toBe("b");
    expect(pb.hidden).toBe(false);
    expect(pa.hidden).toBe(true);
    disposeOwner(f.owner);
  });
  it("manual tab activation and RTL navigation preserve selection separately", () => {
    const f = fixture(), list = document.createElement("div");
    f.root.append(list);
    const a = document.createElement("button"), b = document.createElement("button");
    const pa = document.createElement("section"), pb = document.createElement("section");
    a.id = "ta"; b.id = "tb"; pa.id = "pa"; pb.id = "pb";
    list.append(a, b); f.root.append(pa, pb);
    const tabs = createTabs({ list, owner: f.owner, defaultValue: "a",
      activation: "manual", direction: "rtl" });
    tabs.register({ id: "a", tab: a, panel: pa });
    tabs.register({ id: "b", tab: b, panel: pb });
    a.focus(); a.dispatchEvent(key("ArrowLeft"));
    expect(document.activeElement).toBe(b);
    expect(tabs.selected.value).toBe("a");
    b.dispatchEvent(key("Enter")); flushSync();
    expect(tabs.selected.value).toBe("b");
    disposeOwner(f.owner);
  });
  it("roving items skip disabled and support dynamic removal", () => {
    const f = fixture(), parent = document.createElement("div");
    f.root.append(parent);
    const a = document.createElement("button"), b = document.createElement("button"), c = document.createElement("button");
    parent.append(a, b, c);
    const roving = createRovingFocus({ container: parent, owner: f.owner, orientation: "vertical" });
    roving.register({ id: "a", element: a });
    roving.register({ id: "b", element: b, disabled: true });
    const registration = roving.register({ id: "c", element: c });
    a.focus(); a.dispatchEvent(key("ArrowDown"));
    expect(document.activeElement).toBe(c);
    registration.dispose();
    expect(roving.activeId).toBe("a");
    disposeOwner(f.owner);
  });
  it("disclosure controls hidden panel with native button semantics", () => {
    const f = fixture(), trigger = document.createElement("button"), panel = document.createElement("div");
    panel.id = "details";
    f.root.append(trigger, panel);
    const disclosure = createDisclosure({ trigger, panel, owner: f.owner });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(panel.hidden).toBe(true);
    trigger.click(); flushSync();
    expect(disclosure.expanded.value).toBe(true);
    expect(panel.hidden).toBe(false);
    disposeOwner(f.owner);
  });
  it("exclusive accordion closes a previous uncontrolled disclosure", () => {
    const f = fixture();
    const make = (id: string) => {
      const trigger = document.createElement("button"), panel = document.createElement("div");
      panel.id = id;
      f.root.append(trigger, panel);
      return createDisclosure({ trigger, panel, owner: f.owner });
    };
    const a = make("pane-a"), b = make("pane-b");
    const accordion = createAccordion({ owner: f.owner });
    accordion.add(a); accordion.add(b);
    a.setExpanded(true); flushSync();
    b.setExpanded(true); flushSync();
    expect(a.expanded.value).toBe(false);
    expect(b.expanded.value).toBe(true);
    disposeOwner(f.owner);
  });
  it("menu supports arrow navigation, selection and close", () => {
    const f = fixture(), trigger = document.createElement("button"), content = document.createElement("div");
    content.id = "menu";
    f.root.append(trigger); f.host.append(content);
    const a = document.createElement("button"), b = document.createElement("button");
    content.append(a, b);
    const onSelect = vi.fn();
    const menu = createMenu({ trigger, content, owner: f.owner, overlays: f.overlays });
    menu.register({ id: "a", element: a });
    menu.register({ id: "b", element: b, onSelect });
    trigger.click(); flushSync();
    expect(menu.open.value).toBe(true);
    a.focus(); a.dispatchEvent(key("ArrowDown"));
    expect(document.activeElement).toBe(b);
    b.dispatchEvent(key("Enter")); flushSync();
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(menu.open.value).toBe(false);
    disposeOwner(f.owner);
  });
  it("listbox supports active descendant, typeahead and explicit selection", () => {
    const f = fixture(), list = document.createElement("div");
    f.root.append(list);
    const alpha = document.createElement("div"), beta = document.createElement("div");
    alpha.id = "alpha"; beta.id = "beta";
    alpha.textContent = "Apple"; beta.textContent = "Banana";
    list.append(alpha, beta);
    const lb = createListbox({ element: list, owner: f.owner });
    lb.register({ id: "a", element: alpha }); lb.register({ id: "b", element: beta });
    list.focus();
    list.dispatchEvent(key("b"));
    expect(list.getAttribute("aria-activedescendant")).toBe("beta");
    expect(lb.selected.value).toBeNull();
    list.dispatchEvent(key("Enter")); flushSync();
    expect(lb.selected.value).toBe("b");
    expect(beta.getAttribute("aria-selected")).toBe("true");
    disposeOwner(f.owner);
  });
  it("controlled listbox keeps external selection immutable", () => {
    const f = fixture(), list = document.createElement("div");
    f.root.append(list);
    const item = document.createElement("div"); item.id = "one"; list.append(item);
    const selected = signal<string | null>(null);
    const onChange = vi.fn();
    const lb = createListbox({ element: list, owner: f.owner, selected, onSelectionChange: onChange });
    lb.register({ id: "one", element: item });
    item.click();
    expect(selected.value).toBeNull();
    expect(onChange).toHaveBeenCalledWith("one");
    selected.value = "one"; flushSync();
    expect(item.getAttribute("aria-selected")).toBe("true");
    disposeOwner(f.owner);
  });
  it("tooltip delays focus disclosure and dismisses on Escape", () => {
    vi.useFakeTimers();
    const f = fixture(), trigger = document.createElement("button"), tip = document.createElement("div");
    tip.id = "hint"; tip.textContent = "Help";
    f.root.append(trigger, tip);
    const tooltip = createTooltip({ trigger, tooltip: tip, owner: f.owner, delayMs: 100 });
    expect(tip.hidden).toBe(true);
    trigger.dispatchEvent(new Event("mouseenter"));
    vi.advanceTimersByTime(100); flushSync();
    expect(tooltip.open.value).toBe(true);
    expect(tip.getAttribute("role")).toBe("tooltip");
    trigger.dispatchEvent(key("Escape")); flushSync();
    expect(tip.hidden).toBe(true);
    disposeOwner(f.owner); vi.useRealTimers();
  });
  it("popover dismisses outside interactions without trapping focus", () => {
    const f = fixture(), trigger = document.createElement("button"), content = document.createElement("div");
    content.id = "popup";
    f.root.append(trigger); f.host.append(content);
    const popover = createPopover({ owner: f.owner, trigger, content, overlays: f.overlays });
    trigger.click(); flushSync();
    expect(content.hidden).toBe(false);
    trigger.dispatchEvent(new Event("pointerdown", { bubbles: true, composed: true }));
    flushSync();
    expect(popover.open.value).toBe(false);
    disposeOwner(f.owner);
  });
});
