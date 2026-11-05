// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createOwner, disposeOwner } from "@zaakiyjs/core";
import {
  animateElement, animateOwned, createSpring, createStandalonePresence, createPresence, captureLayout, animateKeyedMoves,
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
    // Finished animations must be cancelled to release WAAPI fill/timeline state.
    expect(api.cancel).toHaveBeenCalledOnce();
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
    expect((await zero.finished).status).toBe("finished");
  });
});

describe("motion cleanup regression cases", () => {
  it("rejects non-finite gesture thresholds and spring instability", () => {
    const element = document.createElement("div");
    expect(() => createGestures(element, { dragThreshold: Number.NaN })).toThrow(RangeError);
    expect(() => createGestures(element, { longPressMs: Infinity })).toThrow(RangeError);
    expect(() => createSpring({ from: 0, to: 1, stiffness: 1e9, onUpdate: vi.fn() }))
      .toThrow(RangeError);
  });

  it("releases pointer capture without reentering release on lostpointercapture", () => {
    const element = document.createElement("div");
    const release = vi.fn(() => element.dispatchEvent(new Event("lostpointercapture")));
    Object.assign(element, {
      setPointerCapture: vi.fn(),
      hasPointerCapture: vi.fn(() => true),
      releasePointerCapture: release
    });
    const gestures = createGestures(element, { onTap: vi.fn() });
    const down = new Event("pointerdown");
    Object.assign(down, { pointerId: 1, pointerType: "mouse", button: 0, clientX: 0, clientY: 0 });
    element.dispatchEvent(down);
    const up = new Event("pointerup");
    Object.assign(up, { pointerId: 1, pointerType: "mouse", clientX: 0, clientY: 0 });
    element.dispatchEvent(up);
    expect(release).toHaveBeenCalledTimes(1);
    gestures.dispose();
  });

  it("disconnects once-only viewport observers and releases their AbortSignal listener", () => {
    let listener!: IntersectionObserverCallback;
    const disconnect = vi.fn();
    class Observer {
      constructor(callback: IntersectionObserverCallback) { listener = callback; }
      observe() {}
      disconnect = disconnect;
    }
    vi.stubGlobal("IntersectionObserver", Observer);
    const ac = new AbortController();
    const add = vi.spyOn(ac.signal, "addEventListener");
    const remove = vi.spyOn(ac.signal, "removeEventListener");
    const onEnter = vi.fn();
    observeViewport(document.createElement("div"), { once: true, signal: ac.signal, onEnter });
    expect(add).toHaveBeenCalledOnce();
    listener([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
    expect(onEnter).toHaveBeenCalledOnce();
    expect(disconnect).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledOnce();
  });

  it("sets a spring to its target with no RAF support instead of freezing at the start", async () => {
    vi.stubGlobal("requestAnimationFrame", undefined);
    const updates: number[] = [];
    const handle = createSpring({ from: 0, to: 10, onUpdate: value => updates.push(value) });
    expect(await handle.finished).toEqual({ status: "skipped", reason: "unsupported" });
    expect(updates).toEqual([0, 10]);
  });

  it("treats an already-resting spring as complete, not unsupported", async () => {
    const handle = createSpring({ from: 4, to: 4, onUpdate: vi.fn() });
    expect(await handle.finished).toEqual({ status: "finished" });
  });

  it("never mutates after aborting an ongoing spring", async () => {
    const callbacks = new Map<number, FrameRequestCallback>();
    let next = 0;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      const id = ++next; callbacks.set(id, callback); return id;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => callbacks.delete(id));
    const abort = new AbortController();
    const onUpdate = vi.fn();
    const handle = createSpring({ from: 0, to: 5, signal: abort.signal, onUpdate });
    abort.abort();
    expect((await handle.finished).status).toBe("cancelled");
    expect(callbacks.size).toBe(0);
    expect(onUpdate).toHaveBeenCalledTimes(1);
  });
});

describe("frozen P2 Contract 11", () => {
  it("exposes readonly-signal phases and typed completion reasons", async () => {
    const owner = createOwner();
    const element = document.createElement("div");
    document.body.append(element);
    const { api } = fakeAnimation(element);
    const handle = animateOwned({
      owner, element, keyframes: [{ opacity: 0 }, { opacity: 1 }],
      timing: { duration: 180 }
    });
    expect(handle.phase.value).toBe("running");
    api.finish();
    expect(await handle.finished).toEqual({ phase: "finished", reason: "completed" });
    expect(handle.phase.value).toBe("finished");
    disposeOwner(owner);
  });

  it("settles the contract with owner-disposed instead of throwing an unhandled cancellation", async () => {
    const owner = createOwner();
    const element = document.createElement("div");
    fakeAnimation(element);
    const handle = animateOwned({ owner, element, keyframes: [], timing: { duration: 200 } });
    disposeOwner(owner);
    expect(await handle.finished).toEqual({ phase: "cancelled", reason: "owner-disposed" });
  });

  it("reports presence phases and never disposes the owning DOM element", async () => {
    const owner = createOwner();
    const element = document.createElement("div");
    document.body.append(element);
    const { api } = fakeAnimation(element);
    const presence = createPresence({
      owner, element,
      enter: { keyframes: [{ opacity: 0 }, { opacity: 1 }], timing: { duration: 100 } },
      exit: { keyframes: [{ opacity: 1 }, { opacity: 0 }], timing: { duration: 100 } }
    });
    const entering = presence.enter();
    expect(presence.phase.value).toBe("entering");
    api.finish();
    expect((await entering.finished).reason).toBe("completed");
    await Promise.resolve();
    expect(presence.phase.value).toBe("present");
    expect(element.isConnected).toBe(true);
    disposeOwner(owner);
    expect(presence.phase.value).toBe("exited");
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
    const presence = createStandalonePresence(element, {
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
      constructor(callback: IntersectionObserverCallback, options: IntersectionObserverInit) {
        void callback; void options;
      }
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
        clientY: 0 });
      Object.defineProperty(event, "timeStamp", { value: time });
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

  it("rejects route commits for disposed owners before touching DOM", async () => {
    const owner = createOwner();
    const commit = vi.fn();
    disposeOwner(owner);
    await expect(runRouteTransition(commit, { owner, document }))
      .rejects.toThrow("disposed");
    expect(commit).not.toHaveBeenCalled();
  });

  it("does not run a delayed native View Transition callback after owner teardown", async () => {
    const owner = createOwner();
    const commit = vi.fn();
    const skipTransition = vi.fn();
    const fakeDocument = {
      startViewTransition(update: () => Promise<void>) {
        const updateCallbackDone = Promise.resolve().then(update);
        return { updateCallbackDone, finished: updateCallbackDone, skipTransition };
      }
    } as unknown as Document;
    const pending = runRouteTransition(commit, {
      owner, document: fakeDocument, reducedMotion: "force"
    });
    disposeOwner(owner);
    await expect(pending).rejects.toThrow("disposed");
    expect(commit).not.toHaveBeenCalled();
    expect(skipTransition).toHaveBeenCalled();
  });

  it("runs route commit on fallback and propagates failed commits", async () => {
    const commit = vi.fn();
    expect(await runRouteTransition(commit, { document })).toEqual({ animated: false });
    expect(commit).toHaveBeenCalledOnce();
    await expect(runRouteTransition(() => { throw new Error("commit error"); }, { document }))
      .rejects.toThrow("commit error");
  });
});
