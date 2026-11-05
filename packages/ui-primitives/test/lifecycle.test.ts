// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createOwner, disposeOwner, runWithOwner } from "@zaakiyjs/core";
import { signal, flushSync } from "@zaakiyjs/signals";
import { createControlledState, createIdScope, createPortal, listen, ownedTimeout } from "../src/index.js";

afterEach(() => { document.body.replaceChildren(); vi.useRealTimers(); });

describe("owned primitives", () => {
  it("disposes event listeners exactly once, including parent disposal", () => {
    const owner = createOwner();
    const button = document.createElement("button");
    const spy = vi.fn();
    const handle = listen(button, "click", spy, owner);
    button.click();
    expect(spy).toHaveBeenCalledTimes(1);
    handle.dispose(); handle.dispose();
    button.click();
    expect(spy).toHaveBeenCalledTimes(1);
    disposeOwner(owner);
    expect(spy).toHaveBeenCalledTimes(1);
  });
  it("cancels scheduled work and supports separate root-local IDs", () => {
    vi.useFakeTimers();
    const first = createOwner(), second = createOwner();
    const one = createIdScope("one", first), two = createIdScope("two", second);
    expect(one.next()).toBe("one-id-1");
    expect(two.next()).toBe("two-id-1");
    const cb = vi.fn();
    ownedTimeout(cb, 10, first);
    disposeOwner(first);
    vi.runAllTimers();
    expect(cb).not.toHaveBeenCalled();
    expect(() => one.next()).toThrow();
    expect(two.next()).toBe("two-id-2");
    disposeOwner(second);
  });
  it("resolves lexical Core owner during synchronous initialization", () => {
    const owner = createOwner();
    const node = document.createElement("div");
    const spy = vi.fn();
    runWithOwner(owner, () => listen(node, "hello", spy));
    disposeOwner(owner);
    node.dispatchEvent(new Event("hello"));
    expect(spy).not.toHaveBeenCalled();
  });
  it("keeps controlled signals parent-owned and deduplicates pending requests", () => {
    const owner = createOwner();
    const external = signal(false);
    const onChange = vi.fn();
    const control = createControlledState({ owner, defaultValue: true, value: external, onChange });
    control.set(true); control.set(true);
    expect(external.value).toBe(false);
    expect(onChange).toHaveBeenCalledTimes(1);
    external.value = true;
    flushSync();
    expect(control.value.value).toBe(true);
    control.set(false);
    expect(onChange).toHaveBeenCalledTimes(2);
    disposeOwner(owner);
    control.set(true);
    expect(onChange).toHaveBeenCalledTimes(2);
  });
  it("supports local uncontrolled Signals without another scheduler", () => {
    const owner = createOwner();
    const onChange = vi.fn();
    const control = createControlledState({ owner, defaultValue: 1, onChange });
    expect(control.value.value).toBe(1);
    control.set(2); control.set(2);
    expect(control.value.value).toBe(2);
    expect(onChange).toHaveBeenCalledTimes(1);
    disposeOwner(owner);
  });
  it("portals detached native nodes without stealing existing compiler nodes", () => {
    const owner = createOwner();
    const host = document.createElement("div");
    document.body.appendChild(host);
    const node = document.createElement("span");
    const portal = createPortal({ host, owner, nodes: [node] });
    expect(node.parentNode).toBe(host);
    expect(() => createPortal({ host, owner, nodes: [node] })).toThrow();
    portal.dispose();
    expect(node.parentNode).toBeNull();
    disposeOwner(owner);
  });
  it("rejects portal ownership crossing application roots", () => {
    const first = createOwner(), second = createOwner();
    const host = document.createElement("div");
    const node = document.createElement("span");
    expect(() => createPortal({ host, nodes: [node], owner: first, contentOwner: second })).toThrow();
    disposeOwner(first); disposeOwner(second);
  });
});
