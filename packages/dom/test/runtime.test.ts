// @vitest-environment jsdom
// Hand-authored ABI fixtures until the compiler emits executable TSX.
import { afterEach, describe, expect, it, vi } from "vitest";
import { signal, flushSync } from "@zaakiyjs/signals";
import { createOwner, disposeOwner } from "@zaakiyjs/core";
import { mount } from "../src/index.js";
import {
  bindAttribute, bindClass, bindProperty, bindRef, bindStyle, bindText,
  cloneStatic, createElement, createText, listen, listenStable, setAttribute,
  setProperty, setStyle
} from "../src/compiler.js";
import { bindConditionalRegion, bindKeyedRegion, createRegion } from "../src/regions.js";

afterEach(() => { document.body.replaceChildren(); });

describe("compiler-lowered native DOM runtime", () => {
  it("runs factory once, mounts multiple nodes, and disposes only its range", () => {
    let calls = 0;
    const container = document.createElement("div");
    const original = document.createElement("aside");
    container.appendChild(original);
    const view = mount(() => {
      calls++;
      return [document.createTextNode("one"), document.createElement("b")];
    }, container);
    expect(calls).toBe(1);
    expect(container.textContent).toBe("one");
    view.dispose();
    view.dispose();
    expect(container.childNodes).toHaveLength(1);
    expect(container.firstChild).toBe(original);
    expect(view.owner.disposed).toBe(true);
  });

  it("uses Text.data with zero unrelated mutations and tracks dynamic dependencies", async () => {
    const choose = signal(true);
    const a = signal(1);
    const b = signal(5);
    const original = document.createElement("span");
    const text = createText("");
    original.appendChild(text);
    const sibling = document.createElement("p");
    const container = document.createElement("div");
    container.append(original, sibling);
    const view = mount((owner) => {
      bindText(owner, text, () => choose.value ? a.value : b.value);
      return document.createComment("mounted");
    }, container);
    flushSync();
    expect(text.data).toBe("1");
    const observed: MutationRecord[] = [];
    const observer = new MutationObserver((records) => observed.push(...records));
    observer.observe(container, { attributes: true, characterData: true, childList: true, subtree: true });
    a.value = 2;
    flushSync();
    await Promise.resolve();
    expect(text.data).toBe("2");
    expect(observed.filter((record) => record.target === text && record.type === "characterData")).toHaveLength(1);
    expect(observed.filter((record) => record.target !== text)).toHaveLength(0);
    observed.length = 0;
    choose.value = false;
    flushSync();
    b.value = 6;
    flushSync();
    a.value = 9;
    flushSync();
    expect(text.data).toBe("6");
    expect(observed.filter((record) => record.target !== text)).toHaveLength(0);
    view.dispose();
    observer.disconnect();
  });

  it("updates native properties, safe attributes, classes, styles and refs", () => {
    const owner = createOwner();
    const input = document.createElement("input");
    const value = signal("start");
    const klass = signal("alpha");
    const ref = vi.fn();
    bindProperty(owner, input, "value", () => value.value);
    bindClass(owner, input, () => klass.value);
    bindStyle(owner, input, "--accent", () => "red");
    bindAttribute(owner, input, "title", () => "safe");
    bindRef(owner, input, ref);
    flushSync();
    input.focus();
    input.setSelectionRange(2, 2);
    value.value = "changed";
    klass.value = "beta";
    flushSync();
    expect(input.value).toBe("changed");
    expect(input.getAttribute("class")).toBe("beta");
    expect(input.style.getPropertyValue("--accent")).toBe("red");
    expect(input.title).toBe("safe");
    expect(ref).toHaveBeenCalledWith(input);
    disposeOwner(owner);
    expect(ref).toHaveBeenLastCalledWith(null);
  });

  it("never interprets text as HTML and blocks unsafe sinks and URLs", () => {
    const node = createText("<img src=x onerror=alert(1)>");
    expect(node.data).toContain("<img");
    const el = document.createElement("a");
    expect(() => setAttribute(el, "href", "javascript:alert(1)")).toThrow();
    expect(() => setAttribute(el, "onclick", "alert(1)")).toThrow();
    expect(() => setProperty(el, "innerHTML", "<b>unsafe</b>")).toThrow();
    expect(() => setProperty(el, "href", "java\nscript:alert(1)")).toThrow();
    expect(() => setStyle(el, "color", "url(javascript:alert(1))")).toThrow();
    expect(() => setAttribute(el, "srcset", "https://example.com/a 1x")).toThrow();
    setAttribute(el, "href", "/safe");
    expect(el.getAttribute("href")).toBe("/safe");
  });

  it("creates SVG namespaces and preserves static subtree source", () => {
    const svg = createElement("svg", "svg");
    const path = createElement("path", "svg");
    svg.appendChild(path);
    setAttribute(path, "xlink:href", "#shape");
    expect(svg.namespaceURI).toBe("http://www.w3.org/2000/svg");
    expect(path.getAttributeNS("http://www.w3.org/1999/xlink", "href")).toBe("#shape");
    const duplicate = cloneStatic(svg);
    expect(duplicate).not.toBe(svg);
    expect(duplicate.firstChild).not.toBe(path);
    expect(duplicate.firstChild?.namespaceURI).toBe(path.namespaceURI);
  });

  it("keeps one listener during handler changes and removes it on disposal", () => {
    const owner = createOwner();
    const button = document.createElement("button");
    const handler = signal<((event: Event) => void)>(() => undefined);
    const first = vi.fn();
    const second = vi.fn();
    handler.value = first;
    listenStable(owner, button, "click", () => handler.value);
    flushSync();
    button.click();
    handler.value = second;
    flushSync();
    button.click();
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    disposeOwner(owner);
    button.click();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("tears down conditional children, listeners and owners once", () => {
    const owner = createOwner();
    const parent = document.createElement("section");
    const region = createRegion(parent);
    const visible = signal(true);
    const called = vi.fn();
    let constructions = 0;
    bindConditionalRegion(owner, region, () => visible.value, (child) => {
      constructions++;
      const button = document.createElement("button");
      listen(child, button, "click", called);
      return button;
    });
    flushSync();
    const original = parent.querySelector("button")!;
    original.click();
    visible.value = false;
    flushSync();
    expect(parent.querySelector("button")).toBeNull();
    original.click();
    expect(called).toHaveBeenCalledTimes(1);
    visible.value = true;
    flushSync();
    expect(constructions).toBe(2);
    expect(parent.querySelector("button")).not.toBe(original);
    disposeOwner(owner);
  });

  it("reuses keyed DOM identity, preserves input state/focus and rejects duplicate keys", () => {
    const owner = createOwner();
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const region = createRegion(parent);
    const entries = signal([{ id: "a" }, { id: "b" }, { id: "c" }]);
    const cleanup = vi.fn();
    const initialized = vi.fn();
    bindKeyedRegion(owner, region, () => entries.value, (item) => item.id, (item, child) => {
      initialized(item.id);
      const input = document.createElement("input");
      input.dataset.key = item.id;
      listen(child, input, "change", cleanup);
      return { node: input };
    });
    flushSync();
    const b = parent.querySelector<HTMLInputElement>('[data-key="b"]')!;
    b.value = "typed";
    b.focus();
    entries.value = [{ id: "c" }, { id: "b" }, { id: "a" }];
    flushSync();
    expect(Array.from(parent.querySelectorAll("input")).map((n) => n.dataset.key)).toEqual(["c", "b", "a"]);
    expect(parent.querySelector('[data-key="b"]')).toBe(b);
    expect(b.value).toBe("typed");
    expect(document.activeElement).toBe(b);
    expect(initialized).toHaveBeenCalledTimes(3);
    expect(() => {
      entries.value = [{ id: "c" }, { id: "c" }];
      flushSync();
    }).toThrow();
    expect(parent.querySelectorAll("input")).toHaveLength(3);
    disposeOwner(owner);
  });
});
