import { afterEach, describe, expect, it, vi } from "vitest";
import { createOwner, disposeOwner, runWithOwner } from "@zaakiyjs/core";
import { createResource, createResourceCache, createTask } from "../src/index.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("review regression: scope, cancellation and disposal races", () => {
  it("keeps a root cache alive when the child that created it unmounts", async () => {
    const root = createOwner();
    const creator = createOwner(root);
    const consumer = createOwner(root);
    const cache = runWithOwner(creator, () => createResourceCache({
      maxEntries: 3, cacheTimeMs: 10_000
    }));
    const resource = runWithOwner(consumer, () => createResource({
      cache, cacheKey: () => "tenant-1:user-1:item",
      load: async () => 123
    }));
    expect(await resource.refresh()).toBe(123);
    disposeOwner(creator);
    expect(cache.disposed).toBe(false);
    expect(await resource.refresh()).toBe(123);
    disposeOwner(root);
    expect(cache.disposed).toBe(true);
    await expect(resource.refresh()).rejects.toMatchObject({ code: "DISPOSED" });
  });

  it("removes repeated operation owners from a long-lived parent", async () => {
    const root = createOwner();
    // Core's OwnerScope deliberately does not expose children. This white-box
    // assertion protects against unbounded owner registrations on hot paths.
    const childCount = (): number =>
      (root as unknown as { children: Set<unknown> }).children.size;
    const baseline = childCount();
    for (let n = 0; n < 150; n++) {
      const resource = createResource({ owner: root, load: async () => n });
      expect(await resource.refresh()).toBe(n);
      resource.dispose();
      const task = createTask({ owner: root, execute: async () => n });
      expect(await task.run(n)).toBe(n);
      task.dispose();
    }
    expect(childCount()).toBe(baseline);
    disposeOwner(root);
  });

  it("rejects queued entries as soon as the task-wide caller aborts", async () => {
    const caller = new AbortController();
    const load = vi.fn(async () => new Promise<number>(() => {}));
    const task = createTask({
      owner: null, signal: caller.signal, concurrency: "queue",
      execute: load
    });
    const first = task.run(1);
    const second = task.run(2);
    const firstRejected = expect(first).rejects.toMatchObject({ kind: "caller" });
    const secondRejected = expect(second).rejects.toMatchObject({ kind: "caller" });
    expect(task.pendingCount.value).toBe(1);
    expect(task.queuedCount.value).toBe(1);
    caller.abort("navigation away");
    await Promise.all([firstRejected, secondRejected]);
    expect(task.pendingCount.value).toBe(0);
    expect(task.queuedCount.value).toBe(0);
    expect(load).toHaveBeenCalledTimes(0);
    task.dispose();
  });

  it("does not enqueue if the queue's shared signal was already aborted", async () => {
    const caller = new AbortController();
    const waiting = deferred<number>();
    const task = createTask({
      owner: null, concurrency: "queue", signal: caller.signal,
      execute: () => waiting.promise
    });
    caller.abort("already cancelled");
    await expect(task.run(1)).rejects.toMatchObject({ kind: "caller" });
    expect(task.queuedCount.value).toBe(0);
    expect(task.pendingCount.value).toBe(0);
    task.dispose();
  });

  it("releases both queue signal listeners when work starts or is cancelled", async () => {
    const caller = new AbortController();
    const perRun = new AbortController();
    const task = createTask({
      owner: null, concurrency: "queue", signal: caller.signal,
      execute: ({ input }: { input: number; signal: AbortSignal; attempt: number }) =>
        input === 1 ? new Promise<number>(() => {}) : Promise.resolve(input)
    });
    const removeGlobal = vi.spyOn(caller.signal, "removeEventListener");
    const removeRun = vi.spyOn(perRun.signal, "removeEventListener");
    const running = task.run(1);
    const queued = task.run(2, { signal: perRun.signal });
    const q = expect(queued).rejects.toMatchObject({ kind: "caller" });
    perRun.abort();
    await q;
    expect(removeGlobal).toHaveBeenCalled();
    expect(removeRun).toHaveBeenCalled();
    const activeCancelled = expect(running).rejects.toMatchObject({ kind: "manual" });
    task.cancel();
    await activeCancelled;
    task.dispose();
  });

  it("clears pending task signals synchronously on permanent disposal", async () => {
    const pending = deferred<number>();
    const task = createTask({
      owner: null, execute: () => pending.promise
    });
    const operation = task.run(1);
    const cancelled = expect(operation).rejects.toMatchObject({ kind: "owner" });
    expect(task.pending.value).toBe(true);
    task.dispose();
    expect(task.pending.value).toBe(false);
    expect(task.pendingCount.value).toBe(0);
    expect(task.status.value).toBe("cancelled");
    await cancelled;
    pending.resolve(1);
    await Promise.resolve();
    expect(task.result.value).toBeUndefined();
  });

  it("clears refreshing resource signals synchronously on disposal", async () => {
    const second = deferred<number>();
    let attempts = 0;
    const resource = createResource({
      owner: null, keepPreviousData: true,
      load: () => ++attempts === 1 ? Promise.resolve(1) : second.promise
    });
    await expect(resource.refresh()).resolves.toBe(1);
    const work = resource.refresh();
    const cancelled = expect(work).rejects.toMatchObject({ kind: "owner" });
    expect(resource.refreshing.value).toBe(true);
    resource.dispose();
    expect(resource.pending.value).toBe(false);
    expect(resource.refreshing.value).toBe(false);
    expect(resource.status.value).toBe("cancelled");
    await cancelled;
    second.resolve(99);
    await Promise.resolve();
    expect(resource.data.value).toBe(1);
  });

  it("does not retain cancelled cache producers after their last consumer leaves", async () => {
    const root = createOwner();
    const cache = createResourceCache({ owner: root, maxEntries: 1 });
    const controller = new AbortController();
    const first = createResource({
      owner: root, cache, cacheKey: () => "private-key", signal: controller.signal,
      load: ({ signal }) => new Promise<number>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      })
    });
    const promise = first.refresh();
    const cancelled = expect(promise).rejects.toMatchObject({ kind: "caller" });
    controller.abort();
    await cancelled;
    const second = createResource({
      owner: root, cache, cacheKey: () => "another-key",
      load: async () => 42
    });
    await expect(second.refresh()).resolves.toBe(42);
    disposeOwner(root);
  });

  it("does not turn ordinary task failures into cancellation", async () => {
    const failure = new TypeError("business rule failed");
    const task = createTask({
      owner: null, concurrency: "parallel",
      execute: async () => { throw failure; }
    });
    await expect(task.run(1)).rejects.toMatchObject({
      code: "TASK_FAILED", cause: failure
    });
    expect(task.error.value?.cause).toBe(failure);
    task.dispose();
  });
});
