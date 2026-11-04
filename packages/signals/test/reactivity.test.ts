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
    const cycle: {
      direct?: ReturnType<typeof computed<number>>;
      a?: ReturnType<typeof computed<number>>;
      b?: ReturnType<typeof computed<number>>;
    } = {};
    cycle.direct = computed(() => cycle.direct!.value + 1);
    expect(() => cycle.direct!.value).toThrow(/circular/);
    cycle.a = computed(() => cycle.b!.value);
    cycle.b = computed(() => cycle.a!.value);
    expect(() => cycle.a!.value).toThrow(/circular/);
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
  it("runs queued effects automatically in a microtask", async () => {
    const input = signal(0);
    const seen: number[] = [];
    const stop = effect(() => { seen.push(input.value); });
    input.value = 1;
    expect(seen).toEqual([0]);
    await Promise.resolve();
    expect(seen).toEqual([0, 1]);
    stop.dispose();
  });
  it("rejects writes from computed even inside untrack", () => {
    const input = signal(0);
    const forbidden = computed(() => { untrack(() => { input.value++; }); return input.value; });
    expect(() => forbidden.value).toThrow(/must not write signals/);
    expect(input.value).toBe(0);
  });
  it("physically detaches subscriber references across derived chains", () => {
    const source = signal(1);
    const inner = computed(() => source.value * 2);
    const outer = computed(() => inner.value + 1);
    const inbound = source as unknown as { readonly observers: ReadonlySet<unknown> };
    const stop = effect(() => { void outer.value; });
    expect(inbound.observers.size).toBe(1);
    stop.dispose();
    expect(inbound.observers.size).toBe(0);
    expect(outer.value).toBe(3);
    expect(inbound.observers.size).toBe(0);
  });
  it("unwinds batching after thrown callbacks", () => {
    const source = signal(0);
    const values: number[] = [];
    const stop = effect(() => { values.push(source.value); });
    expect(() => batch(() => { source.value = 5; throw new Error("interrupted"); })).toThrow("interrupted");
    flushSync();
    expect(values).toEqual([0, 5]);
    stop.dispose();
  });
  it("preserves flushSync callback values", () => {
    const source = signal(0);
    const values: number[] = [];
    const stop = effect(() => { values.push(source.value); });
    const result = flushSync(() => { source.value = 2; return "completed" as const; });
    expect(result).toBe("completed");
    expect(values).toEqual([0, 2]);
    stop.dispose();
  });
  it("recovers after an initial effect failure with an error handler", () => {
    const ready = signal(false);
    const source = signal(1);
    const errors: unknown[] = [];
    const seen: number[] = [];
    const stop = effect(() => {
      const value = source.value;
      if (!ready.value) throw new Error("not ready");
      seen.push(value);
    }, { onError: error => errors.push(error) });
    expect(errors).toHaveLength(1);
    ready.value = true;
    flushSync();
    source.value = 2;
    flushSync();
    expect(seen).toEqual([1, 2]);
    stop.dispose();
  });
  it("recovers a previously failed computed and its consumer", () => {
    const ready = signal(false);
    const input = signal(1);
    const derived = computed(() => {
      if (!ready.value) throw new Error("unavailable");
      return input.value * 3;
    });
    const results: number[] = [];
    const errors: unknown[] = [];
    const stop = effect(() => { results.push(derived.value); }, { onError: error => errors.push(error) });
    expect(errors).toHaveLength(1);
    ready.value = true;
    flushSync();
    input.value = 5;
    flushSync();
    expect(results).toEqual([3, 15]);
    stop.dispose();
  });
  it("retains partial error dependencies until a successful rerun prunes them", () => {
    const chooseOther = signal(false);
    const first = signal(0);
    const second = signal(0);
    const completed: number[] = [];
    const errors: unknown[] = [];
    const stop = effect(() => {
      if (chooseOther.value) {
        void second.value;
        throw new Error("temporary failure");
      }
      completed.push(first.value);
    }, { onError: error => errors.push(error) });
    chooseOther.value = true;
    flushSync();
    second.value++;
    flushSync();
    expect(errors).toHaveLength(2);
    chooseOther.value = false;
    flushSync();
    const before = completed.length;
    second.value++;
    flushSync();
    expect(completed.length).toBe(before);
    first.value++;
    flushSync();
    expect(completed.at(-1)).toBe(1);
    stop.dispose();
  });
  it("self-disposal cannot resurrect subscriptions and cleans returned resources", () => {
    const gate = signal(0);
    const lateDependency = signal(0);
    const ref: { handle?: ReturnType<typeof effect> } = {};
    const cleanup: string[] = [];
    ref.handle = effect(() => {
      if (gate.value > 0) {
        ref.handle?.dispose();
        void lateDependency.value;
        return () => { cleanup.push("late"); };
      }
      return () => { cleanup.push("initial"); };
    });
    gate.value = 1;
    flushSync();
    expect(cleanup).toEqual(["initial", "late"]);
    const inbound = lateDependency as unknown as { readonly observers: ReadonlySet<unknown> };
    expect(inbound.observers.size).toBe(0);
    lateDependency.value++;
    flushSync();
    expect(inbound.observers.size).toBe(0);
  });
  it("disposal in a cleanup cancels the pending next effect body", () => {
    const state = signal(0);
    const ref: { handle?: ReturnType<typeof effect> } = {};
    let executions = 0;
    let cleanups = 0;
    ref.handle = effect(() => {
      void state.value;
      executions++;
      return () => { cleanups++; ref.handle?.dispose(); };
    });
    state.value++;
    flushSync();
    state.value++;
    flushSync();
    expect(executions).toBe(1);
    expect(cleanups).toBe(1);
    const inbound = state as unknown as { readonly observers: ReadonlySet<unknown> };
    expect(inbound.observers.size).toBe(0);
  });
  it("rejects a synchronous nested scheduler flush in cleanup", () => {
    const state = signal(0);
    const errors: unknown[] = [];
    const stop = effect(() => {
      void state.value;
      return () => { flushSync(); };
    }, { onError: error => errors.push(error) });
    state.value++;
    flushSync();
    expect(errors).toHaveLength(1);
    expect(String(errors[0])).toMatch(/reenter/);
    stop.dispose();
  });
  it("completes independent jobs when another effect throws", () => {
    const failSource = signal(0);
    const successSource = signal(0);
    const seen: number[] = [];
    const failing = effect(() => { if (failSource.value > 0) throw new Error("isolated fault"); });
    const succeeding = effect(() => { seen.push(successSource.value); });
    batch(() => { failSource.value++; successSource.value++; });
    expect(() => flushSync()).toThrow("isolated fault");
    expect(seen).toEqual([0, 1]);
    failing.dispose(); succeeding.dispose();
  });
  it("randomized conditional dependency switching matches an independent oracle", () => {
    let seed = 0xabc12345;
    const next = () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0);
    const select = signal(0);
    const inputs = Array.from({ length: 24 }, () => signal(0));
    const projection = computed(() => inputs[select.value]!.value);
    const nested = computed(() => projection.value * 2 + 1);
    const seen: number[] = [];
    const stop = effect(() => { seen.push(nested.value); });
    const reference = Array(24).fill(0) as number[];
    for (let step = 0; step < 500; step++) {
      const index = next() % inputs.length;
      const value = next() % 10_000;
      batch(() => { select.value = index; inputs[index]!.value = value; reference[index] = value; });
      flushSync();
      expect(seen.at(-1)).toBe(reference[index]! * 2 + 1);
      const unrelated = (index + 1) % inputs.length;
      const before = seen.length;
      inputs[unrelated]!.value = next() % 10_000;
      flushSync();
      expect(seen.length).toBe(before);
    }
    stop.dispose();
  });
  it("reattaches a previously cold computed to upstream signals", () => {
    const source = signal(0);
    const derived = computed(() => source.value + 1);
    expect(derived.value).toBe(1);
    source.value = 1;
    const seen: number[] = [];
    const stop = effect(() => { seen.push(derived.value); });
    source.value = 2;
    flushSync();
    expect(seen).toEqual([2, 3]);
    stop.dispose();
    const inbound = source as unknown as { readonly observers: ReadonlySet<unknown> };
    expect(inbound.observers.size).toBe(0);
  });
  it("reattaches cold nested computed chains after changing their inputs", () => {
    const source = signal(1);
    const inner = computed(() => source.value + 1);
    const outer = computed(() => inner.value + 1);
    expect(outer.peek()).toBe(3);
    source.value = 3;
    const results: number[] = [];
    const stop = effect(() => { results.push(outer.value); });
    source.value = 8;
    flushSync();
    expect(results).toEqual([5, 10]);
    stop.dispose();
  });
  it("reconnects previously disposed cold computed subscribers", () => {
    const source = signal(1);
    const inner = computed(() => source.value * 2);
    const outer = computed(() => inner.value + 1);
    const first = effect(() => { void outer.value; });
    first.dispose();
    source.value = 3;
    const observed: number[] = [];
    const second = effect(() => { observed.push(outer.value); });
    source.value = 4;
    flushSync();
    expect(observed).toEqual([7, 9]);
    second.dispose();
    const inbound = source as unknown as { readonly observers: ReadonlySet<unknown> };
    expect(inbound.observers.size).toBe(0);
  });
  it("releases failed computed dependencies when its consumer is disposed", () => {
    const input = signal(0);
    const errors: unknown[] = [];
    const failing = computed(() => {
      void input.value;
      throw new Error("unavailable");
    });
    const stop = effect(() => { void failing.value; }, { onError: error => errors.push(error) });
    expect(errors).toHaveLength(1);
    expect((input as unknown as { readonly observers: ReadonlySet<unknown> }).observers.size).toBe(1);
    stop.dispose();
    expect((input as unknown as { readonly observers: ReadonlySet<unknown> }).observers.size).toBe(0);
  });
  it("allows more than 10,000 independent subscribers without cycle false positives", () => {
    const shared = signal(0);
    let executions = 0;
    const handles = Array.from({ length: 12_000 }, () => effect(() => {
      void shared.value;
      executions++;
    }));
    shared.value++;
    expect(() => flushSync()).not.toThrow();
    expect(executions).toBe(24_000);
    handles.forEach(handle => handle.dispose());
    const inbound = shared as unknown as { readonly observers: ReadonlySet<unknown> };
    expect(inbound.observers.size).toBe(0);
  });
  it("does not track cleanup signals through a surrounding effect", () => {
    const irrelevant = signal(0);
    const disposeChild = signal(false);
    const child = effect(() => () => { void irrelevant.value; });
    let parentRuns = 0;
    const parent = effect(() => {
      parentRuns++;
      if (disposeChild.value) child.dispose();
    });
    disposeChild.value = true;
    flushSync();
    expect(parentRuns).toBe(2);
    irrelevant.value++;
    flushSync();
    expect(parentRuns).toBe(2);
    parent.dispose();
  });
  it("does not track nested error handlers through a parent effect", () => {
    const irrelevant = signal(0);
    let parentRuns = 0;
    const parent = effect(() => {
      parentRuns++;
      effect(() => { throw new Error("expected"); }, {
        onError: () => { void irrelevant.value; }
      }).dispose();
    });
    irrelevant.value++;
    flushSync();
    expect(parentRuns).toBe(1);
    parent.dispose();
  });
  it("drains independent user-phase effects after a render cycle fails", () => {
    const cyclicSource = signal(0);
    const otherSource = signal(0);
    const seen: number[] = [];
    const cyclic = effect(() => {
      const value = cyclicSource.value;
      if (value > 0) cyclicSource.value = value + 1;
    }, { phase: "render" });
    const independent = effect(() => { seen.push(otherSource.value); });
    batch(() => {
      cyclicSource.value = 1;
      otherSource.value = 1;
    });
    expect(() => flushSync()).toThrow(/reactive cycle/);
    expect(seen).toEqual([0, 1]);
    cyclic.dispose();
    otherSource.value = 2;
    flushSync();
    expect(seen).toEqual([0, 1, 2]);
    independent.dispose();
  });
  it("does not rerun consumers when a computed result is unchanged", () => {
    const input = signal(0);
    const parity = computed(() => input.value % 2);
    const seen: number[] = [];
    const stop = effect(() => { seen.push(parity.value); });
    for (let i = 1; i <= 20; i++) {
      input.value = i * 2;
      flushSync();
    }
    expect(seen).toEqual([0]);
    input.value = 21;
    flushSync();
    expect(seen).toEqual([0, 1]);
    stop.dispose();
  });
  it("skips unchanged nested computed values but keeps changed updates", () => {
    const value = signal(0);
    const intermediate = computed(() => Math.floor(value.value / 10));
    const nested = computed(() => intermediate.value + 1);
    const seen: number[] = [];
    const stop = effect(() => { seen.push(nested.value); });
    value.value = 1;
    flushSync();
    value.value = 9;
    flushSync();
    expect(seen).toEqual([1]);
    value.value = 10;
    flushSync();
    expect(seen).toEqual([1, 2]);
    stop.dispose();
  });
  it("does not suppress direct signal subscriptions alongside derived values", () => {
    const direct = signal(0);
    const source = signal(0);
    const stable = computed(() => source.value >= 0);
    const events: string[] = [];
    const stop = effect(() => { events.push(direct.value + ":" + stable.value); });
    source.value = 1;
    flushSync();
    expect(events).toEqual(["0:true", "0:true"]);
    direct.value++;
    flushSync();
    expect(events.at(-1)).toBe("1:true");
    stop.dispose();
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
