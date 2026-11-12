// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createOwner, disposeOwner, mountOwner } from "@zaakiyjs/core";
import { flushSync, signal } from "@zaakiyjs/signals";
import { bindKeyedRegion, createRegion } from "../src/compiler.js";

afterEach(() => document.body.replaceChildren());

describe("unchanged keyed snapshot fast path", () => {
  it("keeps nodes, focus, owners and updates identical for equal list snapshots", () => {
    const owner = createOwner();
    const host = document.createElement("div");
    document.body.append(host);
    type Item = { readonly id: number; readonly title: string };
    const initial: readonly Item[] = Array.from({ length: 256 }, (_, id) => ({ id, title: "Item " + id }));
    const values = signal(initial);
    const creates = vi.fn();
    const updates = vi.fn();
    bindKeyedRegion(owner, createRegion(host), () => values.value, item => item.id, item => {
      creates();
      const node = document.createElement("input");
      node.dataset.id = String(item.id);
      node.value = item.title;
      return { node, update(next: Item) { updates(next); node.value = next.title; } };
    });
    mountOwner(owner);
    const original = [...host.querySelectorAll("input")];
    const focused = original[128]!;
    focused.focus();
    focused.setSelectionRange(1, 3);
    const insertion = vi.spyOn(host, "insertBefore");
    try {
      for (let i = 0; i < 15; i++) {
        values.value = [...values.value];
        flushSync();
      }
      expect(creates).toHaveBeenCalledTimes(256);
      expect(updates).not.toHaveBeenCalled();
      expect(insertion).not.toHaveBeenCalled();
      expect([...host.querySelectorAll("input")]).toEqual(original);
      expect(document.activeElement).toBe(focused);
      expect(focused.selectionStart).toBe(1);
      expect(focused.selectionEnd).toBe(3);
      values.value = values.value.map(item => item.id === 128 ? { ...item, title: "Changed" } : item);
      flushSync();
      expect(updates).toHaveBeenCalledTimes(1);
      expect(focused.value).toBe("Changed");
      values.value = [...values.value].reverse();
      flushSync();
      expect([...host.querySelectorAll("input")].map(el => Number(el.dataset.id)))
        .toEqual(Array.from({ length: 256 }, (_, i) => 255 - i));
      expect(document.activeElement).toBe(focused);
    } finally { insertion.mockRestore(); disposeOwner(owner); }
  });
});
