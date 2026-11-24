import { describe, expect, it } from "vitest";
import { computed, effect, flushSync, signal } from "../src/index";

describe("lazy derived-read tracking", () => {
  it("reruns direct-signal effects on every changed value and detaches on disposal", () => {
    const value = signal(1);
    const observed: number[] = [];
    const handle = effect(() => { observed.push(value.value); });
    value.value = 2;
    flushSync();
    value.value = 3;
    flushSync();
    expect(observed).toEqual([1, 2, 3]);
    handle.dispose();
    value.value = 4;
    flushSync();
    expect(observed).toEqual([1, 2, 3]);
  });

  it("keeps computed-only equality suppression and dynamic subscription switching", () => {
    const source = signal(1);
    const even = computed(() => source.value % 2);
    const derivedReads: number[] = [];
    const derivedEffect = effect(() => { derivedReads.push(even.value); });
    source.value = 3;
    flushSync();
    expect(derivedReads).toEqual([1]);
    source.value = 4;
    flushSync();
    expect(derivedReads).toEqual([1, 0]);
    derivedEffect.dispose();

    const chooseLeft = signal(true);
    const left = signal(10);
    const right = signal(20);
    const selected: number[] = [];
    const handle = effect(() => {
      selected.push(chooseLeft.value ? left.value : right.value);
    });
    left.value = 11;
    flushSync();
    chooseLeft.value = false;
    flushSync();
    left.value = 12;
    flushSync();
    right.value = 21;
    flushSync();
    expect(selected).toEqual([10, 11, 20, 21]);
    handle.dispose();
    right.value = 22;
    flushSync();
    expect(selected).toEqual([10, 11, 20, 21]);
  });
});