// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createOwner, disposeOwner, mountOwner, onCleanup } from "@zaakiyjs/core";
import { createRegion } from "@zaakiyjs/dom/compiler";
import { flushSync, signal } from "@zaakiyjs/signals";
import { bindAnimatedConditionalRegion } from "../src/conditional.js";

afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function fakeNativeAnimation() {
  let resolve!: () => void;
  let reject!: (reason?: unknown) => void;
  const finished = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return {
    finished,
    finish: vi.fn(() => resolve()),
    cancel: vi.fn(() => reject(new Error("cancelled"))),
    pause: vi.fn(), play: vi.fn()
  };
}

describe("owner-safe native Motion ↔ DOM conditional region bridge", () => {
  it("retains focused native node on exit, cancels stale animation on reentry, removes only after final exit", async () => {
    const host = document.createElement("section");
    document.body.appendChild(host);
    const owner = createOwner();
    const region = createRegion(host);
    const visible = signal(true);
    const nativeAnimations: ReturnType<typeof fakeNativeAnimation>[] = [];
    let created = 0, cleaned = 0;
    bindAnimatedConditionalRegion(owner, region, () => visible.value, () => {
      created++;
      onCleanup(() => { cleaned++; });
      const button = document.createElement("button");
      button.textContent = "Keep focus";
      Object.assign(button, {animate: vi.fn(() => {
        const animation = fakeNativeAnimation();
        nativeAnimations.push(animation);
        return animation;
      })});
      return button;
    }, {exit: {keyframes: [{opacity: 1}, {opacity: 0}], duration: 150}, maxExitMs: 2000});
    mountOwner(owner);
    const button = host.querySelector("button")!;
    button.focus();
    visible.value = false;
    flushSync();
    expect(host.querySelector("button")).toBe(button);
    expect(cleaned).toBe(0);
    expect(nativeAnimations).toHaveLength(1);
    visible.value = true;
    flushSync();
    expect(nativeAnimations[0]?.cancel).toHaveBeenCalledTimes(1);
    expect(host.querySelector("button")).toBe(button);
    expect(document.activeElement).toBe(button);
    expect(created).toBe(1);
    visible.value = false;
    flushSync();
    expect(nativeAnimations).toHaveLength(2);
    nativeAnimations[1]!.finish();
    await vi.waitFor(() => expect(host.querySelector("button")).toBeNull());
    expect(cleaned).toBe(1);
    disposeOwner(owner);
    expect(cleaned).toBe(1);
  });

  it("aborts and tears down an unfinished exit synchronously when the parent owner is disposed", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const owner = createOwner();
    const region = createRegion(host);
    const show = signal(true);
    const exit = fakeNativeAnimation();
    let cleaned = 0;
    bindAnimatedConditionalRegion(owner,region,()=>show.value,()=>{
      onCleanup(() => { cleaned++; });
      const span = document.createElement("span");
      Object.assign(span,{animate:vi.fn(()=>exit)});
      return span;
    },{exit:{keyframes:[{opacity:1},{opacity:0}],duration:200},maxExitMs:2000});
    mountOwner(owner);
    show.value = false;
    flushSync();
    expect(host.querySelector("span")).not.toBeNull();
    disposeOwner(owner);
    expect(exit.cancel).toHaveBeenCalledTimes(1);
    expect(host.querySelector("span")).toBeNull();
    expect(cleaned).toBe(1);
    await Promise.resolve();
    expect(cleaned).toBe(1);
  });

  it("skips native animation for reduced motion and still disposes the child owner", async () => {
    vi.stubGlobal("matchMedia", () => ({matches:true,addEventListener:vi.fn(),removeEventListener:vi.fn()}));
    const host = document.createElement("div");
    document.body.appendChild(host);
    const owner = createOwner();
    const region = createRegion(host);
    const show = signal(true);
    let cleaned = 0;
    const animate = vi.fn();
    bindAnimatedConditionalRegion(owner,region,()=>show.value,()=>{
      onCleanup(()=>{cleaned++;});
      const element = document.createElement("span");
      Object.assign(element,{animate});
      return element;
    },{exit:{keyframes:[{opacity:1},{opacity:0}],duration:180,reducedMotion:"respect"},maxExitMs:2000});
    mountOwner(owner);
    show.value = false;
    flushSync();
    await vi.waitFor(() => expect(host.querySelector("span")).toBeNull());
    expect(animate).not.toHaveBeenCalled();
    expect(cleaned).toBe(1);
    disposeOwner(owner);
  });

  it("rejects missing exit options without creating any DOM owner or global patch", () => {
    const owner = createOwner();
    const host = document.createElement("div");
    const region = createRegion(host);
    expect(() => bindAnimatedConditionalRegion(owner,region,()=>true,()=>document.createElement("div"),
      undefined as never)).toThrow(/requires exit animation/);
    disposeOwner(owner);
  });
});
