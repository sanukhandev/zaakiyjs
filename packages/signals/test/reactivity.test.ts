import { describe, expect, it, vi } from "vitest";
import { batch, computed, effect, flushSync, signal, untrack } from "../src/index";

// Effects run once synchronously. Subsequent work is queued until flushSync/microtask.
describe("signals", () => {
  it("reads and writes typed values", () => {
    const count = signal(1);
    expect(count.value).toBe(1);
    count.value = 2;
    expect(count.peek()).toBe(2);
  });
  it("defaults to Object.is and accepts contract-approved custom equality", () => {
    const nan = signal(NaN);
    const changed = vi.fn(() => { void nan.value; });
    const handle = effect(changed);
    nan.value = NaN;
    flushSync();
    expect(changed).toHaveBeenCalledTimes(1);
    nan.value = 1;
    flushSync();
    expect(changed).toHaveBeenCalledTimes(2);
    handle.dispose();
    const obj = signal({ id: 1 }, { equals: (a, b) => a.id === b.id });
    const run = vi.fn(() => { void obj.value; });
    const stop = effect(run);
    obj.value = { id: 1 };
    flushSync();
    expect(run).toHaveBeenCalledTimes(1);
    stop.dispose();
  });
  it("tracks dependencies and detaches conditional branches", () => {
    const useLeft = signal(true);
    const left = signal("L");
    const right = signal("R");
    const seen: string[] = [];
    const stop = effect(() => { seen.push(useLeft.value ? left.value : right.value); });
    right.value = "r";
    flushSync();
    expect(seen).toEqual(["L"]);
    useLeft.value = false;
    flushSync();
    left.value = "l";
    flushSync();
    right.value = "rr";
    flushSync();
    expect(seen).toEqual(["L", "r", "rr"]);
    stop.dispose();
  });
  it("evaluates computed lazily and caches unchanged dependencies", () => {
    const input = signal(2);
    const calc = vi.fn(() => input.value * 3);
    const triple = computed(calc);
    expect(calc).not.toHaveBeenCalled();
    expect(triple.value).toBe(6);
    expect(triple.peek()).toBe(6);
    expect(calc).toHaveBeenCalledTimes(1);
    input.value = 3;
    expect(triple.value).toBe(9);
    expect(calc).toHaveBeenCalledTimes(2);
    expect(triple.value).toBe(9);
    expect(calc).toHaveBeenCalledTimes(2);
  });
  it("maintains nested computed chains without observers", () => {
    const base = signal(1);
    const double = computed(() => base.value * 2);
    const four = computed(() => double.value * 2);
    expect(four.value).toBe(4);
    base.value = 3;
    expect(four.value).toBe(12);
  });
  it("supports dynamic computed dependencies", () => {
    const chooseA = signal(true);
    const a = signal(1);
    const b = signal(2);
    const derivation = computed(() => chooseA.value ? a.value : b.value);
    const seen: number[] = [];
    const stop = effect(() => { seen.push(derivation.value); });
    chooseA.value = false;
    flushSync();
    a.value++;
    flushSync();
    b.value++;
    flushSync();
    expect(seen).toEqual([1, 2, 3]);
    stop.dispose();
  });
  it("deduplicates nested batches and gives render phase priority", () => {
    const value = signal(0);
    const order: string[] = [];
    const user = effect(() => { order.push("user:" + value.value); });
    const render = effect(() => { order.push("render:" + value.value); }, { phase: "render" });
    order.length = 0;
    batch(() => {
      value.value = 1;
      batch(() => { value.value = 2; value.value = 3; });
      value.value = 4;
    });
    expect(order).toEqual([]);
    flushSync();
    expect(order).toEqual(["render:4", "user:4"]);
    user.dispose();
    render.dispose();
  });
  it("flushes user writes that schedule higher-priority render work", () => {
    const a = signal(0);
    const b = signal(0);
    const records: string[] = [];
    const user = effect(() => { records.push("user:" + a.value); if (a.value > 0) b.value = a.value; });
    const render = effect(() => { records.push("render:" + b.value); }, { phase: "render" });
    records.length = 0;
    a.value = 5;
    flushSync();
    expect(records).toEqual(["user:5", "render:5"]);
    user.dispose(); render.dispose();
  });
  it("does not register untracked or peek reads", () => {
    const tracked = signal(0);
    const ignored = signal(0);
    const runs = vi.fn(() => { void tracked.value; untrack(() => ignored.value); ignored.peek(); });
    const stop = effect(runs);
    ignored.value++;
    flushSync();
    expect(runs).toHaveBeenCalledTimes(1);
    tracked.value++;
    flushSync();
    expect(runs).toHaveBeenCalledTimes(2);
    stop.dispose();
  });
  it("runs cleanup before rerun, exactly once on disposal", () => {
    const state = signal(1);
    const calls: string[] = [];
    const h = effect(() => { const n = state.value; calls.push("run:" + n); return () => calls.push("clean:" + n); });
    state.value++;
    flushSync();
    h.dispose(); h.dispose();
    state.value++;
    flushSync();
    expect(calls).toEqual(["run:1", "clean:1", "run:2", "clean:2"]);
  });
  it("handles error callbacks and allows the queue to resume", () => {
    const n = signal(0);
    const errors: unknown[] = [];
    const saw: number[] = [];
    const stop = effect(() => { const v = n.value; if (v === 1) throw Error("failed"); saw.push(v); }, { onError: e => errors.push(e) });
    n.value = 1;
    flushSync();
    n.value = 2;
    flushSync();
    expect(errors).toHaveLength(1);
    expect(saw).toEqual([0, 2]);
    stop.dispose();
  });
  it("does not corrupt tracking after uncaught effect exceptions", () => {
    const state = signal(0);
    const faulty = effect(() => { if (state.value > 0) throw Error("boom"); });
    state.value = 1;
    expect(() => flushSync()).toThrow("boom");
    faulty.dispose();
    const next = signal(0);
    const spy = vi.fn(() => { void next.value; });
    const good = effect(spy);
    next.value++;
    flushSync();
    expect(spy).toHaveBeenCalledTimes(2);
    good.dispose();
  });
  it("detects direct and indirect computed cycles", () => {
    let direct!: ReturnType<typeof computed<number>>;
    direct = computed(() => direct.value + 1);
    expect(() => direct.value).toThrow(/circular/);
    let a!: ReturnType<typeof computed<number>>;
    let b!: ReturnType<typeof computed<number>>;
    a = computed(() => b.value);
    b = computed(() => a.value);
    expect(() => a.value).toThrow(/circular/);
  });
  it("detects cyclic writes and resets flush state", () => {
    const count = signal(0);
    const handle = effect(() => { const value = count.value; if (value > 0) count.value = value + 1; });
    count.value = 1;
    expect(() => flushSync()).toThrow(/reactive cycle/);
    handle.dispose();
    const other = signal(0);
    const seen: number[] = [];
    const stop = effect(() => { seen.push(other.value); });
    other.value = 1;
    flushSync();
    expect(seen).toEqual([0, 1]);
    stop.dispose();
  });
  it("scales to a large subscription fanout and fully detaches disposed effects", () => {
    const shared = signal(0);
    const counters = new Uint16Array(1_000);
    const handles = [...counters].map((_, i) => effect(() => { void shared.value; counters[i]!++; }));
    shared.value++;
    flushSync();
    expect([...counters].every(x => x === 2)).toBe(true);
    handles.forEach(h => h.dispose());
    shared.value++;
    flushSync();
    expect([...counters].every(x => x === 2)).toBe(true);
  });
  it("detaches computed chains when the last effect is disposed", () => {
    const source = signal(1);
    let calculations = 0;
    const inner = computed(() => { calculations++; return source.value + 1; });
    const outer = computed(() => inner.value * 2);
    const stop = effect(() => { void outer.value; });
    stop.dispose();
    source.value = 5;
    expect(outer.value).toBe(12);
    expect(calculations).toBe(2);
  });
  it("holds cached unobserved computed values without retaining an inbound subscription", () => {
    const source = signal(2);
    const derived = computed(() => source.value + 1);
    expect(derived.value).toBe(3);
    source.value = 4;
    expect(derived.value).toBe(5);
  });
  it("randomized graph agrees with a simple pure reference model", () => {
    let seed = 0x12345678;
    const next = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0);
    const sources = Array.from({ length: 32 }, () => signal(0));
    const sums = Array.from({ length: 16 }, (_, i) => computed(() => sources[i]!.value + sources[i + 16]!.value));
    const rows: number[][] = [];
    const stop = effect(() => { rows.push(sums.map(sum => sum.value)); });
    const reference = Array(32).fill(0) as number[];
    for (let step = 0; step < 500; step++) {
      batch(() => { for (let j = 0; j < 3; j++) { const idx = next() % sources.length; const value = next() % 10_000; sources[idx]!.value = value; reference[idx] = value; } });
      flushSync();
      expect(rows.at(-1)).toEqual(Array.from({ length: 16 }, (_, i) => reference[i]! + reference[i + 16]!));
    }
    stop.dispose();
  });
});
