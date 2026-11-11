// @vitest-environment jsdom
import {afterEach, describe, expect, it, vi} from "vitest";
import {createOwner, disposeOwner, mountOwner, onCleanup} from "@zaakiyjs/core";
import {flushSync, signal} from "@zaakiyjs/signals";
import {bindKeyedRegion, createRegion} from "../src/compiler.js";

afterEach(() => { document.body.replaceChildren(); });

describe("keyed list sparse movement budgets", () => {
  it("moves no retained items on append, one on prepend/rotate and at most two on edge swap", () => {
    const owner = createOwner();
    const host = document.createElement("div");
    document.body.append(host);
    const sequence = signal<readonly number[]>(Array.from({length: 128}, (_, i) => i));
    const cleanups: number[] = [];
    bindKeyedRegion(owner, createRegion(host), () => sequence.value, item => item, item => {
      onCleanup(() => cleanups.push(item));
      const node = document.createElement("input");
      node.type = "text";
      node.dataset.id = String(item);
      node.value = "value " + item;
      return {node};
    });
    mountOwner(owner);
    const original = new Map([...host.querySelectorAll("input")]
      .map(node => [Number(node.dataset.id), node]));
    const focused = original.get(64)!;
    focused.focus();
    focused.setSelectionRange(2, 5, "backward");
    const insertions = vi.spyOn(host, "insertBefore");
    const ids = () => [...host.querySelectorAll("input")].map(node => Number(node.dataset.id));
    try {
      sequence.value = [...sequence.value, 128];
      flushSync();
      expect(ids()).toEqual([...Array.from({length: 129}, (_, i) => i)]);
      expect(insertions).toHaveBeenCalledTimes(1); // Insert new row, no reorder.

      insertions.mockClear();
      sequence.value = [-1, ...sequence.value];
      flushSync();
      expect(ids()).toEqual([-1, ...Array.from({length: 129}, (_, i) => i)]);
      expect(insertions).toHaveBeenCalledTimes(2); // Stage new row, move it to front.

      insertions.mockClear();
      sequence.value = [sequence.value[sequence.value.length - 1]!,
        ...sequence.value.slice(1, -1), sequence.value[0]!];
      flushSync();
      expect(ids()).toEqual(sequence.value);
      expect(insertions.mock.calls.length).toBeLessThanOrEqual(2);

      insertions.mockClear();
      sequence.value = [sequence.value[sequence.value.length - 1]!, ...sequence.value.slice(0, -1)];
      flushSync();
      expect(ids()).toEqual(sequence.value);
      expect(insertions.mock.calls.length).toBeLessThanOrEqual(1);

      expect(document.activeElement).toBe(focused);
      expect(focused.selectionStart).toBe(2);
      expect(focused.selectionEnd).toBe(5);
      expect(focused.selectionDirection).toBe("backward");
      for (const [id, node] of original) {
        expect(host.querySelector('input[data-id="' + id + '"]')).toBe(node);
      }
      expect(cleanups).toHaveLength(0);
    } finally {
      insertions.mockRestore();
      disposeOwner(owner);
    }
    expect(cleanups).toHaveLength(130);
    expect(new Set(cleanups).size).toBe(130);
    expect(host.querySelectorAll("input")).toHaveLength(0);
  });
});
