// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { createRegion } from "../src/regions.js";

describe("compiler native-region transactional marker creation", () => {
  it("inserts an ordered start/end pair at the requested stable boundary", () => {
    const host = document.createElement("section");
    const sibling = document.createElement("button");
    host.append(sibling);
    const before = host.innerHTML;
    const region = createRegion(host, sibling);
    expect(region.start.nodeType).toBe(8);
    expect(region.end.nodeType).toBe(8);
    expect([...host.childNodes]).toEqual([region.start, region.end, sibling]);
    expect(sibling.outerHTML).toBe(before);
  });

  it("removes the first marker if the second insertion throws", () => {
    const host = document.createElement("section");
    const sibling = document.createElement("button");
    host.append(sibling);
    const initial = host.innerHTML;
    const original = host.insertBefore.bind(host);
    let calls = 0;
    host.insertBefore = ((node: Node, reference: Node | null) => {
      if (++calls === 2) throw new Error("second anchor insertion failed");
      return original(node, reference);
    }) as typeof host.insertBefore;
    expect(() => createRegion(host, sibling)).toThrow("second anchor insertion failed");
    expect(host.innerHTML).toBe(initial);
    expect([...host.childNodes]).toEqual([sibling]);
    expect(calls).toBe(2);
  });

  it("preserves original failure and rollback failure separately", () => {
    const host = document.createElement("section");
    const originalInsert = host.insertBefore.bind(host);
    let inserts = 0;
    host.insertBefore = ((node: Node, before: Node | null) => {
      if (++inserts === 2) throw new Error("second insert failed");
      return originalInsert(node, before);
    }) as typeof host.insertBefore;
    host.removeChild = (() => { throw new Error("rollback failed"); }) as typeof host.removeChild;
    try {
      createRegion(host);
      throw new Error("Expected aggregate failure");
    } catch (error) {
      expect(error).toBeInstanceOf(AggregateError);
      expect((error as AggregateError).errors.map(String)).toEqual([
        "Error: second insert failed", "Error: rollback failed"
      ]);
    }
  });
});
