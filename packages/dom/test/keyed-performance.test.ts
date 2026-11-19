// @vitest-environment jsdom
import {afterEach, describe, expect, it} from "vitest";
import {createOwner, disposeOwner, mountOwner, onCleanup} from "@zaakiyjs/core";
import {flushSync, signal} from "@zaakiyjs/signals";
import {bindKeyedRegion, createRegion} from "../src/compiler.js";

afterEach(() => { document.body.replaceChildren(); });

describe("large keyed-region extraction and lifecycle invariants", () => {
  it("reorders a large multiroot list without replacing retained nodes or unrelated siblings", async () => {
    const owner = createOwner();
    const host = document.createElement("div");
    document.body.append(host);
    const unrelatedBefore = document.createElement("aside");
    const unrelatedAfter = document.createElement("footer");
    host.append(unrelatedBefore);
    const region = createRegion(host);
    host.append(unrelatedAfter);
    const values = signal<readonly number[]>(Array.from({length: 128}, (_, i) => i));
    const disposed: number[] = [];
    bindKeyedRegion(owner, region, () => values.value, item => item, item => {
      onCleanup(() => disposed.push(item));
      const nodes = document.createDocumentFragment();
      const input = document.createElement("input");
      input.type = "text";
      input.dataset.key = String(item);
      input.value = "row-" + item;
      const label = document.createElement("span");
      label.textContent = String(item);
      nodes.append(input, label);
      return {node: nodes};
    });
    mountOwner(owner);
    const originals = new Map([...host.querySelectorAll("input")].map(node => [node.dataset.key, node]));
    const focused = originals.get("64")!;
    focused.focus();
    focused.setSelectionRange(1, 4, "backward");
    const records: MutationRecord[] = [];
    const observer = new MutationObserver(list => records.push(...list));
    observer.observe(host, {childList: true, subtree: true});
    try {
      values.value = [...values.value].reverse();
      flushSync();
      await Promise.resolve();
      expect([...host.querySelectorAll("input")].map(node => Number(node.dataset.key)))
        .toEqual(Array.from({length: 128}, (_, i) => 127 - i));
      expect(host.querySelectorAll("span")).toHaveLength(128);
      expect(host.firstChild).toBe(unrelatedBefore);
      expect(host.lastChild).toBe(unrelatedAfter);
      expect(records.every(record => ![...record.addedNodes, ...record.removedNodes]
        .some(node => node === unrelatedBefore || node === unrelatedAfter))).toBe(true);
      for (const [id, node] of originals) {
        expect(host.querySelector('input[data-key="' + id + '"]')).toBe(node);
      }
      expect(document.activeElement).toBe(focused);
      expect(focused.selectionStart).toBe(1);
      expect(focused.selectionEnd).toBe(4);
      expect(focused.selectionDirection).toBe("backward");
      expect(disposed).toHaveLength(0);
      values.value = values.value.slice(1).concat(values.value[0]!);
      flushSync();
      expect([...host.querySelectorAll("input")].map(node => Number(node.dataset.key)))
        .toEqual([...Array.from({length: 127}, (_, i) => 126 - i), 127]);
      expect(disposed).toHaveLength(0);
    } finally {
      observer.disconnect();
      disposeOwner(owner);
    }
    expect(disposed).toHaveLength(128);
    expect(new Set(disposed).size).toBe(128);
    expect(host.querySelectorAll("input")).toHaveLength(0);
    expect(host.firstChild).toBe(unrelatedBefore);
    expect(host.lastChild).toBe(unrelatedAfter);
  });

  it("updates just one changed keyed item without disturbing the surrounding DOM", async () => {
    const owner = createOwner();
    const host = document.createElement("div");
    document.body.append(host);
    const items = signal<readonly {id: number; label: string}[]>(Array.from(
      {length: 128}, (_, id) => ({id, label: "Row " + id})
    ));
    bindKeyedRegion(owner, createRegion(host), () => items.value, item => item.id, item => {
      const label = document.createElement("span");
      label.textContent = item.label;
      return {
        node: label,
        update(next: {id: number; label: string}) {
          if (label.textContent !== next.label) label.textContent = next.label;
        }
      };
    });
    mountOwner(owner);
    const originals = [...host.querySelectorAll("span")];
    const records: MutationRecord[] = [];
    const observer = new MutationObserver(list => records.push(...list));
    observer.observe(host, {childList: true, characterData: true, subtree: true});
    try {
      items.value = items.value.map(item =>
        item.id === 64 ? {...item, label: "changed"} : item);
      flushSync();
      await Promise.resolve();
      expect(host.querySelectorAll("span")[64]?.textContent).toBe("changed");
      expect([...host.querySelectorAll("span")]).toEqual(originals);
      const modified = records.filter(record => record.type === "childList" ||
        record.type === "characterData");
      expect(modified.length).toBeGreaterThan(0);
      expect(modified.every(record => record.target === originals[64])).toBe(true);
    } finally {
      observer.disconnect();
      disposeOwner(owner);
    }
  });
});
