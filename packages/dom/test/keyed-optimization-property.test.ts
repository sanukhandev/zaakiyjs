// @vitest-environment jsdom
import {afterEach, describe, expect, it, vi} from "vitest";
import {createOwner, disposeOwner, mountOwner, onCleanup} from "@zaakiyjs/core";
import {flushSync, signal} from "@zaakiyjs/signals";
import {bindKeyedRegion, createRegion} from "../src/compiler.js";

afterEach(() => { document.body.replaceChildren(); });

describe("keyed reconciliation deterministic stress", () => {
  it("preserves retained identity, list order and exact owner disposal over 40 transitions", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const owner = createOwner();
    const state = signal<readonly number[]>(Array.from({length: 150}, (_, i) => i));
    const destroyed = new Map<number, number>();
    let created = 0;
    bindKeyedRegion(owner, createRegion(host), () => state.value, key => key, key => {
      created++;
      const node = document.createElement("input");
      node.dataset.id = String(key);
      node.value = "value-" + key;
      onCleanup(() => destroyed.set(key, (destroyed.get(key) ?? 0) + 1));
      return {node};
    });
    mountOwner(owner);
    const getNodes = () => [...host.querySelectorAll("input")];
    const getOrder = () => getNodes().map(node => Number(node.dataset.id));
    let rand = 0x9e3779b9;
    const next = () => {
      rand ^= rand << 13;
      rand ^= rand >>> 17;
      rand ^= rand << 5;
      return rand >>> 0;
    };
    let lastFresh = 1000;
    for (let round = 0; round < 40; round++) {
      const before = new Map(getNodes().map(node => [Number(node.dataset.id), node]));
      let result = [...state.value];
      switch (round % 6) {
        case 0: result.reverse(); break;
        case 1: result = [result[result.length - 1]!, ...result.slice(0, -1)]; break;
        case 2: {
          const shuffled = [...result];
          for (let i = shuffled.length - 1; i > 0; i--) {
            const j = next() % (i + 1);
            [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
          }
          result = shuffled;
          break;
        }
        case 3: result = [lastFresh++, ...result]; break;
        case 4: result = result.filter((_, idx) => idx % 19 !== 0); break;
        case 5: result = [...result, lastFresh++, lastFresh++]; break;
      }
      state.value = result;
      flushSync();
      expect(getOrder()).toEqual(result);
      for (const node of getNodes()) {
        const id = Number(node.dataset.id);
        if (before.has(id)) expect(node).toBe(before.get(id));
        expect(node.value).toBe("value-" + id);
      }
    }
    const changes = vi.fn();
    const observer = new MutationObserver(changes);
    observer.observe(host, {subtree: true, childList: true});
    const current = getNodes();
    state.value = [...state.value];
    flushSync();
    await Promise.resolve();
    expect(getNodes()).toEqual(current);
    expect(changes).not.toHaveBeenCalled();
    observer.disconnect();
    disposeOwner(owner);
    expect(host.querySelectorAll("input")).toHaveLength(0);
    const count = [...destroyed.values()].reduce((sum, n) => sum + n, 0);
    expect(count).toBe(created);
    expect([...destroyed.values()].every(value => value >= 1)).toBe(true);
  });
});
