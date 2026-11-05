// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createOwner, disposeOwner } from "@zaakiyjs/core";
import {
  animateElement, createSpring, createPresence, captureLayout, animateKeyedMoves,
  observeViewport, createGestures
} from "../src/index.js";
import { runRouteTransition } from "../src/route.js";

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); document.body.replaceChildren(); });

function fakeAnimation(element: Element) {
  let resolve!: () => void;
  let reject!: (value?: unknown) => void;
  const finished = new Promise<void>((ok, fail) => { resolve = ok; reject = fail; });
  const api = {
    finished,
    finish: vi.fn(() => resolve()),
    cancel: vi.fn(() => reject(new Error("cancelled"))),
    pause: vi.fn(), play: vi.fn()
  };
  const animate = vi.fn(() => api);
  Object.assign(element, { animate });
  return { api, animate };
}

describe("animation ownership and WAAPI", () => {
  it("settles completion and consumes cancellation rejection", async () => {
    const element = document.createElement("div");
    document.body.append(element);
    const { api } = fakeAnimation(element);
    const handle = animateElement(element, { keyframes: [{ opacity: 0 }, { opacity: 1 }] });
    expect(handle.status).toBe("running");
    api.finish();
    expect(await handle.finished).toEqual({ status: "finished" });
    expect(handle.status).toBe("finished");
    handle.cancel();
    expect(api.cancel).not.toHaveBeenCalled();
  });

  it("cancels on owner disposal and settles once", async () => {
    const owner = createOwner();
    const element = document.createElement("div");
    const { api } = fakeAnimation(element);
    const handle = animateElement(element, { keyframes: [], owner });
    disposeOwner(owner);
    expect(await handle.finished).toEqual({ status: "cancelled", reason: "owner-disposed" });
    expect(api.cancel).toHaveBeenCalledTimes(1);
    handle.dispose();
  });

  it("honors abort and missing WAAPI without leaving unresolved completion", async () => {
    const target = document.createElement("div");
    const abort = new AbortController();
    const { api } = fakeAnimation(target);
    const handle = animateElement(target, { keyframes: [], signal: abort.signal });
    abort.abort();
    expect(await handle.finished).toMatchObject({ status: "cancelled", reason: "signal" });
    expect(api.cancel).toHaveBeenCalledOnce();
    const unsupported = animateElement(document.createElement("div"), { keyframes: [] });
    expect(await unsupported.finished).toEqual({ status: "skipped", reason: "unsupported" });
  });

  it("reacts to a reduced-motion preference change", async () => {
    let enabled = false;
    let changed: (() => void) | null = null;
    const media = {
      get matches() { return enabled; },
      addEventListener: vi.fn((_type: string, listener: () => void) => { changed = listener; }),
      removeEventListener: vi.fn()
    };
    vi.stubGlobal("matchMedia", () => media);
    const target = document.createElement("div");
    const { api } = fakeAnimation(target);
    const handle = animateElement(target, { keyframes: [{ opacity: 0 }, { opacity: 1 }] });
    enabled = true;
    (changed as (() => void) | null)?.();
    expect(await handle.finished).toEqual({ status: "skipped", reason: "reduced-motion" });
    expect(api.finish).toHaveBeenCalledOnce();
    expect(media.removeEventListener).toHaveBeenCalled();
  });

  it("validates invalid duration and skips zero duration", async () => {
    const target = document.createElement("div");
    expect(() => animateElement(target, { keyframes: [], duration: -1 })).toThrow(RangeError);
    const zero = animateElement(target, { keyframes: [], duration: 0 });
    expect((await zero.finished).status).toBe("skipped");
  });
});

describe("spring, presence and layout", () => {
  it("reaches rest with deterministic frames, and does not schedule another frame", async () => {
    let frameId = 0;
    const callbacks = new Map<number, FrameRequestCallback>();
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callbacks.set(++frameId, callback); return frameId;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => callbacks.delete(id));
    const updates: number[] = [];
    const handle = createSpring({ from: 0, to: 5, onUpdate: v => updates.push(v) });
    for (let i = 1; i < 2000 && handle.status === "running"; i++) {
      const current = [...callbacks.entries()];
      callbacks.clear();
      current.forEach(([, callback]) => callback(i * 16.67));
    }
    expect(await handle.finished).toEqual({ status: "finished" });
    expect(updates.at(-1)).toBe(5);
    expect(callbacks.size).toBe(0);
  });

  it("cancels a running spring and never writes after cancellation", async () => {
    const scheduled = new Map<number, FrameRequestCallback>();
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      scheduled.set(1, callback); return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => scheduled.delete(id));
    const write = vi.fn();
    const handle = createSpring({ from: 0, to: 10, onUpdate: write });
    handle.cancel();
    expect(await handle.finished).toMatchObject({ status: "cancelled" });
    expect(scheduled.size).toBe(0);
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("supersedes exit, preserves owner, and never removes the parent DOM", async () => {
    const owner = createOwner();
    const element = document.createElement("div");
    document.body.append(element);
    const { api } = fakeAnimation(element);
    const exited = vi.fn();
    const presence = createPresence(element, {
      owner, enter: { keyframes: [] }, exit: { keyframes: [] }, onExited: exited
    });
    presence.setPresent(false);
    expect(presence.state).toBe("exiting");
    presence.setPresent(true);
    expect(presence.state).toBe("entering");
    expect(api.cancel).toHaveBeenCalled();
    await Promise.resolve();
    expect(exited).not.toHaveBeenCalled();
    expect(owner.disposed).toBe(false);
    disposeOwner(owner);
    expect(presence.state).toBe("disposed");
  });

  it("captures stable element identity across keyed movement", () => {
    const root = document.createElement("div");
    const a = document.createElement("input"), b = document.createElement("input");
    root.append(a, b); document.body.append(root);
    const before = captureLayout([a, b]);
    root.insertBefore(b, a);
    fakeAnimation(a); fakeAnimation(b);
    const movements = animateKeyedMoves(before);
    expect([...movements.keys()]).toEqual([a, b]);
    expect(root.children[0]).toBe(b);
    expect(root.children[1]).toBe(a);
    for (const handle of movements.values()) handle.dispose();
  });
});

describe("observers, gestures and route adapter", () => {
  it("disconnects viewport observer on owner disposal", () => {
    const disconnect = vi.fn();
    const observe = vi.fn();
    class Observer {
      constructor(_cb: IntersectionObserverCallback, _opts: IntersectionObserverInit) {}
      observe = observe;
      disconnect = disconnect;
    }
    vi.stubGlobal("IntersectionObserver", Observer);
    const owner = createOwner();
    observeViewport(document.createElement("div"), { owner, onEnter: vi.fn() });
    expect(observe).toHaveBeenCalledOnce();
    disposeOwner(owner);
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it("handles pointer tap, drag, swipe and keyboard activation", () => {
    const element = document.createElement("button");
    const onTap = vi.fn(), onDrag = vi.fn(), onSwipe = vi.fn(), onKeyActivate = vi.fn();
    const controller = createGestures(element, {
      onTap, onDrag, onSwipe, onKeyActivate, swipeVelocity: 0.1
    });
    const pointer = (type: string, x: number, time: number) => {
      const event = new Event(type);
      Object.assign(event, { pointerId: 1, pointerType: "touch", button: 0, clientX: x,
        clientY: 0, timeStamp: time });
      element.dispatchEvent(event);
    };
    pointer("pointerdown", 0, 0);
    pointer("pointerup", 0, 20);
    expect(onTap).toHaveBeenCalledOnce();
    pointer("pointerdown", 0, 100);
    pointer("pointermove", 60, 120);
    pointer("pointerup", 60, 130);
    expect(onDrag).toHaveBeenCalledOnce();
    expect(onSwipe).toHaveBeenCalledOnce();
    element.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(onKeyActivate).toHaveBeenCalledOnce();
    controller.dispose();
    pointer("pointerdown", 0, 200);
    pointer("pointerup", 0, 250);
    expect(onTap).toHaveBeenCalledOnce();
  });

  it("runs route commit on fallback and propagates failed commits", async () => {
    const commit = vi.fn();
    expect(await runRouteTransition(commit, { document })).toEqual({ animated: false });
    expect(commit).toHaveBeenCalledOnce();
    await expect(runRouteTransition(() => { throw new Error("commit error"); }, { document }))
      .rejects.toThrow("commit error");
  });
});
