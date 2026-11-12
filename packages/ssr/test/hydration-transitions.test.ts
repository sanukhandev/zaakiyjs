import { describe, expect, it } from "vitest";
import { createHydrationTransitionCoordinator } from "../src/hydration-transitions.js";

describe("H5 navigation hydration transactions", () => {
  it("supersedes earlier routes and refuses stale mutations", () => {
    const manager = createHydrationTransitionCoordinator();
    const old = manager.start("products");
    let writes = 0;
    expect(old.commit(() => ++writes)).toBe(1);
    const next = manager.start("account");
    expect(old.signal.aborted).toBe(true);
    expect(old.current).toBe(false);
    expect(() => old.commit(() => ++writes)).toThrow();
    expect(writes).toBe(1);
    expect(next.commit(() => ++writes)).toBe(2);
    manager.dispose();
    expect(next.signal.aborted).toBe(true);
    expect(() => next.commit(() => ++writes)).toThrow();
    expect(() => manager.start("other")).toThrow();
  });
  it("combines caller cancellation without global patching", () => {
    const manager = createHydrationTransitionCoordinator();
    const external = new AbortController();
    const tx = manager.start("product", external.signal);
    external.abort("navigation canceled");
    expect(tx.signal.aborted).toBe(true);
    expect(tx.signal.reason).toBe("navigation canceled");
    expect(() => tx.commit(() => 1)).toThrow();
    const aborted = new AbortController();
    aborted.abort("already canceled");
    expect(manager.start("product", aborted.signal).signal.aborted).toBe(true);
    manager.dispose();
  });
  it("rejects malformed routes before superseding a valid transaction", () => {
    const manager = createHydrationTransitionCoordinator();
    const tx = manager.start("safe");
    expect(() => manager.start("../admin")).toThrow();
    expect(tx.current).toBe(true);
    manager.dispose();
  });
  it("rejects stale reentrant abort listeners", () => {
    const manager = createHydrationTransitionCoordinator();
    const old = manager.start("old");
    let latest: ReturnType<typeof manager.start> | undefined;
    old.signal.addEventListener("abort", () => { latest = manager.start("reentered"); });
    const candidate = manager.start("candidate");
    expect(candidate.current).toBe(false);
    expect(candidate.signal.aborted).toBe(true);
    expect(latest?.current).toBe(true);
    manager.dispose();
  });
});
