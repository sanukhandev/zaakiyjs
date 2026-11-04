import { describe, expect, it } from "vitest";
import { rewriteKeyedItemRead } from "../src/keyed.js";

describe("keyed item expression rewrite", () => {
  it("rewrites identifier reads without rewriting literal text or member names", () => {
    const result = rewriteKeyedItemRead('item.name + "-item-" + holder.item', "item", "cell");
    expect(result.readsItem).toBe(true);
    expect(result.source).toContain("cell.value.name");
    expect(result.source).toContain('"-item-"');
    expect(result.source).toContain("holder.item");
  });
  it("rewrites event callback reads of the current item", () => {
    const result = rewriteKeyedItemRead('() => save(item.id)', "item", "cell");
    expect(result.source).toContain("cell.value.id");
  });
  it("rejects nested item shadowing", () => {
    expect(() => rewriteKeyedItemRead('((item) => item.id)(other)', "item", "cell"))
      .toThrow(/shadows keyed item/);
  });
  it("does not manufacture reactive references for static expressions", () => {
    const result = rewriteKeyedItemRead('"item" + holder.item', "item", "cell");
    expect(result).toEqual({ source: '"item" + holder.item', readsItem: false });
  });
});
