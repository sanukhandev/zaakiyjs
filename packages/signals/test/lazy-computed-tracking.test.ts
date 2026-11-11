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

  it("retains computed equality suppression and reattaches when a branch changes", () => {
    const source = signal(1);
    const useComputed = signal(false);
    const even = computed(() => source.value % 2);
    const observed: number[] = [];
    const handle = effect(() => {
      observed.push(useComputed.value ? even.value : source.value);
    });
    source.value = 2;
    flushSync();
    useComputed.value = true;
    flushSync();
    source.value = 4;
    flushSync();
    // The derived value is unchanged, so the effect is not needlessly rerun.
    expect(observed).toEqual([1, 2, 0]);
    source.value = 5;
    flushSync();
    expect(observed).toEqual([1, 2, 0, 1]);
    useComputed.value = false;
    flushSync();
    source.value = 6;
    flushSync();
    expect(observed).toEqual([1, 2, 0, 1, 5, 6]);
    handle.dispose();
  });
});