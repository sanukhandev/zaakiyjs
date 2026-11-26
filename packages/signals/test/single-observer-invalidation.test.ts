import { describe, expect, it } from "vitest";
import { computed, effect, flushSync, signal } from "../src/index";

describe("observer invalidation cardinalities", () => {
  it("notifies one direct subscriber, then releases it fully", () => {
    const source = signal(0);
    const values: number[] = [];
    const subscriber = effect(() => { values.push(source.value); });
    const inbound = source as unknown as { readonly observers: ReadonlySet<unknown> };
    expect(inbound.observers.size).toBe(1);
    source.value = 1;
    source.value = 2;
    flushSync();
    source.value = 3;
    flushSync();
    expect(values).toEqual([0, 2, 3]);
    subscriber.dispose();
    expect(inbound.observers.size).toBe(0);
    source.value = 4;
    flushSync();
    expect(values).toEqual([0, 2, 3]);
  });

  it("keeps computed equality and single-observer propagation intact", () => {
    const source = signal(0);
    const parity = computed(() => source.value % 2);
    const values: number[] = [];
    const subscriber = effect(() => { values.push(parity.value); });
    source.value = 2;
    flushSync();
    expect(values).toEqual([0]);
    source.value = 3;
    flushSync();
    expect(values).toEqual([0, 1]);
    subscriber.dispose();
    source.value = 4;
    flushSync();
    expect(values).toEqual([0, 1]);
  });

  it("preserves fan-out after subscriptions move between one and several observers", () => {
    const source = signal(0);
    const first: number[] = [];
    const second: number[] = [];
    const third: number[] = [];
    const a = effect(() => { first.push(source.value); });
    const b = effect(() => { second.push(source.value); });
    const c = effect(() => { third.push(source.value); });
    source.value = 1;
    flushSync();
    b.dispose();
    c.dispose();
    source.value = 2;
    flushSync();
    expect(first).toEqual([0, 1, 2]);
    expect(second).toEqual([0, 1]);
    expect(third).toEqual([0, 1]);
    a.dispose();
  });
});
