import { describe, expect, it } from "vitest";
import { createHydrationStreamAssembler } from "../src/hydration-stream.js";

const options = { buildId: "a".repeat(64), routeId: "product", boundaryId: "b".repeat(32) };
const data = (index: number, text: string, final = false) => ({
  ...options, index, final, bytes: new TextEncoder().encode(text)
});
describe("H5 bounded ordered streaming payload", () => {
  it("assembles exact bytes only after a final contiguous segment", () => {
    const assembler = createHydrationStreamAssembler(options);
    const first = data(0, "hello ");
    expect(assembler.push(first)).toBeNull();
    first.bytes.fill(0); // accepted segment must be copied
    expect(new TextDecoder().decode(assembler.push(data(1, "world", true)))).toBe("hello world");
    expect(assembler.complete).toBe(true);
    expect(assembler.receivedBytes).toBe(11);
    expect(() => assembler.push(data(2, "", true))).toThrow();
  });
  it("refuses out-of-order, duplicate and cross-route fragments", () => {
    const a = createHydrationStreamAssembler(options);
    expect(() => a.push(data(1, "late"))).toThrow();
    expect(a.push(data(0, "ok"))).toBeNull();
    expect(() => a.push(data(0, "again"))).toThrow();
    expect(() => a.push({ ...data(1, "wrong"), routeId: "different" })).toThrow();
  });
  it("enforces byte, fragment and abort budgets", () => {
    const controller = new AbortController();
    const a = createHydrationStreamAssembler({ ...options, maxBytes: 3, signal: controller.signal });
    a.push(data(0, "ab"));
    expect(() => a.push(data(1, "cd", true))).toThrow(/byte limit/);
    expect(() => a.push(data(1, "z", true))).toThrow(/aborted/);
    const b = createHydrationStreamAssembler({ ...options, signal: controller.signal });
    controller.abort();
    expect(() => b.push(data(0, "hi", true))).toThrow(/aborted/);
    const c = createHydrationStreamAssembler({ ...options, maxFragments: 1 });
    c.push(data(0, "unfinished"));
    expect(() => c.push(data(1, "late", true))).toThrow();
    c.abort();
  });
  it("rejects unsafe manifest identity and budgets", () => {
    expect(() => createHydrationStreamAssembler({ ...options, routeId: "../other" })).toThrow();
    expect(() => createHydrationStreamAssembler({ ...options, maxBytes: 0 })).toThrow();
  });
});
