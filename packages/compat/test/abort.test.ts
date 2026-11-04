import { afterEach, describe, expect, it, vi } from "vitest";
import { composeAbortSignals, scopedTimeoutSignal } from "../src/abort.js";

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("scoped browser AbortSignal helper", () => {
  it("preserves the first abort reason and does not abort callers", () => {
    const a = new AbortController();
    const b = new AbortController();
    const owned = composeAbortSignals([a.signal, b.signal]);
    a.abort(new Error("first"));
    b.abort(new Error("second"));
    expect(owned.signal.aborted).toBe(true);
    expect((owned.signal.reason as Error).message).toBe("first");
    expect(b.signal.aborted).toBe(true);
    owned.dispose();
    owned.dispose();
  });
  it("returns an already aborted signal and cleans up earlier subscriptions", () => {
    const a = new AbortController();
    const b = new AbortController();
    const removal = vi.spyOn(a.signal, "removeEventListener");
    b.abort("prior");
    const owned = composeAbortSignals([a.signal, b.signal]);
    expect(owned.signal.aborted).toBe(true);
    expect(owned.signal.reason).toBe("prior");
    expect(removal).toHaveBeenCalledWith("abort", expect.any(Function));
    owned.dispose();
  });
  it("disposes listeners without aborting the composed signal", () => {
    const a = new AbortController();
    const removal = vi.spyOn(a.signal, "removeEventListener");
    const owned = composeAbortSignals([a.signal]);
    owned.dispose();
    a.abort("late");
    expect(owned.signal.aborted).toBe(false);
    expect(removal).toHaveBeenCalledOnce();
  });
  it("sends a TimeoutError and clears the timer on completion", () => {
    vi.useFakeTimers();
    const owned = scopedTimeoutSignal(20);
    vi.advanceTimersByTime(20);
    expect(owned.signal.aborted).toBe(true);
    expect((owned.signal.reason as DOMException).name).toBe("TimeoutError");
    expect(vi.getTimerCount()).toBe(0);
  });
  it("propagates a parent cancellation and cleans up", () => {
    vi.useFakeTimers();
    const parent = new AbortController();
    const removal = vi.spyOn(parent.signal, "removeEventListener");
    const owned = scopedTimeoutSignal(100, parent.signal);
    parent.abort("user");
    expect(owned.signal.reason).toBe("user");
    expect(vi.getTimerCount()).toBe(0);
    expect(removal).toHaveBeenCalled();
  });
  it("supports owner disposal without cancelling the parent or local signal", () => {
    vi.useFakeTimers();
    const parent = new AbortController();
    const owned = scopedTimeoutSignal(500, parent.signal);
    owned.dispose();
    vi.advanceTimersByTime(500);
    expect(owned.signal.aborted).toBe(false);
    expect(parent.signal.aborted).toBe(false);
  });
  it.each([-1, 0.1, Infinity, Number.MAX_SAFE_INTEGER])("rejects invalid timeout %s", timeout => {
    expect(() => scopedTimeoutSignal(timeout)).toThrow(RangeError);
  });
  it("handles already aborted parent and zero timeout", () => {
    vi.useFakeTimers();
    const parent = new AbortController();
    parent.abort("before");
    const cancelled = scopedTimeoutSignal(20, parent.signal);
    expect(cancelled.signal.reason).toBe("before");
    expect(vi.getTimerCount()).toBe(0);
    const immediate = scopedTimeoutSignal(0);
    vi.runOnlyPendingTimers();
    expect(immediate.signal.aborted).toBe(true);
  });
});
