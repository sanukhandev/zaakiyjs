import { describe, expect, it } from "vitest";
import { computed, effect, foundationStatus, signal } from "../src/index";

describe("@zaakiyjs/signals implementation", () => {
  it("exports a working public surface", () => {
    expect(foundationStatus).toEqual({ package: "@zaakiyjs/signals", implemented: true });
    const base = signal(1);
    const doubled = computed(() => base.value * 2);
    const results: number[] = [];
    const stop = effect(() => { results.push(doubled.value); });
    base.value = 2;
    stop.dispose();
    expect(results).toEqual([2]);
  });
});
