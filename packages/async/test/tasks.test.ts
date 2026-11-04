import { afterEach, describe, expect, it, vi } from "vitest";
import { createOwner, disposeOwner, runWithOwner } from "@zaakiyjs/core";
import { BusyError, ConfigurationError, createTask } from "../src/index.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("explicit async tasks", () => {
  it("does nothing until run; returns native Promise and readonly state", async () => {
    const execute = vi.fn(async ({ input }: { input: number; signal: AbortSignal; attempt: number }) => input * 2);
    const task = createTask({ execute, owner: null });
    expect(execute).not.toHaveBeenCalled();
    expect(await task.run(3)).toBe(6);
    expect(task.result.value).toBe(6);
    expect(task.lastSuccessful.value).toBe(6);
    expect(task.pendingCount.value).toBe(0);
    expect(task.status.value).toBe("success");
    task.dispose();
    await expect(task.run(2)).rejects.toMatchObject({ code: "DISPOSED" });
  });

  it("wraps ordinary errors without losing causes", async () => {
    const cause = new TypeError("unexpected");
    const task = createTask({ owner: null, execute: async () => { throw cause; } });
    await expect(task.run("x")).rejects.toMatchObject({ code: "TASK_FAILED", cause });
    expect(task.status.value).toBe("error");
    expect(task.error.value?.cause).toBe(cause);
    task.dispose();
  });

  it("latest policy cancels the earlier task and ignores late fulfillment", async () => {
    const older = deferred<string>();
    const newer = deferred<string>();
    const seen: AbortSignal[] = [];
    const task = createTask<string, string>({
      owner: null, concurrency: "latest",
      execute: ({ input, signal }) => { seen.push(signal); return input === "old" ? older.promise : newer.promise; }
    });
    const a = task.run("old");
    await vi.waitFor(() => expect(seen).toHaveLength(1));
    const b = task.run("new");
    await expect(a).rejects.toMatchObject({ kind: "superseded" });
    await vi.waitFor(() => expect(seen).toHaveLength(2));
    newer.resolve("new");
    await expect(b).resolves.toBe("new");
    older.resolve("old");
    await Promise.resolve();
    expect(seen[0]?.aborted).toBe(true);
    expect(task.result.value).toBe("new");
    task.dispose();
  });

  it("parallel policy has aggregate pending counts and newest-started winner", async () => {
    const older = deferred<number>(), newer = deferred<number>();
    const task = createTask<number, number>({
      owner: null, concurrency: "parallel",
      execute: ({ input }) => input === 1 ? older.promise : newer.promise
    });
    const a = task.run(1), b = task.run(2);
    expect(task.pendingCount.value).toBe(2);
    newer.resolve(20);
    await expect(b).resolves.toBe(20);
    expect(task.pendingCount.value).toBe(1);
    older.resolve(10);
    await expect(a).resolves.toBe(10);
    expect(task.pendingCount.value).toBe(0);
    expect(task.result.value).toBe(20);
    task.dispose();
  });

  it("queue policy executes FIFO and tracks running vs waiting separately", async () => {
    const resolvers: Array<(value: number) => void> = [];
    const started: number[] = [];
    const task = createTask<number, number>({
      owner: null, concurrency: "queue", maxQueue: 3,
      execute: ({ input }) => {
        started.push(input);
        return new Promise<number>(resolve => resolvers.push(resolve));
      }
    });
    const first = task.run(1), second = task.run(2), third = task.run(3);
    expect(task.pendingCount.value).toBe(1);
    expect(task.queuedCount.value).toBe(2);
    await vi.waitFor(() => expect(started).toEqual([1]));
    resolvers[0]!(11);
    await expect(first).resolves.toBe(11);
    await vi.waitFor(() => expect(started).toEqual([1, 2]));
    resolvers[1]!(22);
    await expect(second).resolves.toBe(22);
    await vi.waitFor(() => expect(started).toEqual([1, 2, 3]));
    resolvers[2]!(33);
    await expect(third).resolves.toBe(33);
    expect(task.result.value).toBe(33);
    expect(task.pending.value).toBe(false);
    task.dispose();
  });

  it("enforces queue capacity with a structured error", async () => {
    const task = createTask<number, number>({
      owner: null, concurrency: "queue", maxQueue: 1,
      execute: async () => new Promise<number>(() => {})
    });
    const a = task.run(1), b = task.run(2);
    await expect(task.run(3)).rejects.toMatchObject({ code: "QUEUE_FULL" });
    task.cancel();
    await expect(a).rejects.toMatchObject({ kind: "manual" });
    await expect(b).rejects.toMatchObject({ kind: "manual" });
    task.dispose();
  });

  it("cancels a queued invocation on its individual caller signal", async () => {
    const controller = new AbortController();
    const first = deferred<number>();
    const execute = vi.fn(({ input }: { input: number; signal: AbortSignal; attempt: number }) =>
      input === 1 ? first.promise : Promise.resolve(input)
    );
    const task = createTask({ owner: null, concurrency: "queue", execute });
    const a = task.run(1);
    const b = task.run(2, { signal: controller.signal });
    expect(task.queuedCount.value).toBe(1);
    controller.abort("cancel queued");
    await expect(b).rejects.toMatchObject({ kind: "caller" });
    expect(task.queuedCount.value).toBe(0);
    first.resolve(1);
    await expect(a).resolves.toBe(1);
    expect(execute).toHaveBeenCalledTimes(1);
    task.dispose();
  });

  it("reject policy rejects overlapping runs instead of dropping them", async () => {
    const done = deferred<number>();
    const task = createTask<number, number>({ owner: null, concurrency: "reject", execute: () => done.promise });
    const a = task.run(1);
    await expect(task.run(2)).rejects.toBeInstanceOf(BusyError);
    done.resolve(1);
    await expect(a).resolves.toBe(1);
    task.dispose();
  });

  it("manual cancellation aborts all parallel tasks", async () => {
    const task = createTask<number, number>({
      owner: null, concurrency: "parallel", execute: () => new Promise<number>(() => {})
    });
    const a = task.run(1), b = task.run(2);
    task.cancel();
    await expect(a).rejects.toMatchObject({ kind: "manual" });
    await expect(b).rejects.toMatchObject({ kind: "manual" });
    expect(task.pendingCount.value).toBe(0);
    task.dispose();
  });

  it("reset cancels operations and clears shared state", async () => {
    const task = createTask({ owner: null, execute: async (ctx: { input: number; signal: AbortSignal; attempt: number }) => ctx.input });
    await expect(task.run(2)).resolves.toBe(2);
    expect(task.result.value).toBe(2);
    task.reset();
    expect(task.result.value).toBeUndefined();
    expect(task.error.value).toBeNull();
    expect(task.status.value).toBe("idle");
    task.dispose();
  });

  it("disposal synchronously cancels active work and prevents late state writes", async () => {
    const owner = createOwner();
    const source = deferred<number>();
    const task = runWithOwner(owner, () => createTask<number, number>({ execute: () => source.promise }));
    const work = task.run(1);
    disposeOwner(owner);
    await expect(work).rejects.toMatchObject({ kind: "owner" });
    source.resolve(1);
    await Promise.resolve();
    expect(task.result.value).toBeUndefined();
    await expect(task.run(2)).rejects.toMatchObject({ code: "DISPOSED" });
  });

  it("supports explicit owner injection outside lexical context", async () => {
    const owner = createOwner();
    const task = createTask({ owner, execute: async (ctx: { input: number; signal: AbortSignal; attempt: number }) => ctx.input });
    await expect(task.run(8)).resolves.toBe(8);
    disposeOwner(owner);
    await expect(task.run(1)).rejects.toMatchObject({ code: "DISPOSED" });
  });

  it("times out tasks including uncooperative operations", async () => {
    vi.useFakeTimers();
    const task = createTask({ owner: null, timeoutMs: 100, execute: async () => new Promise<void>(() => {}) });
    const work = task.run(1);
    const rejected = expect(work).rejects.toMatchObject({ code: "TIMEOUT", kind: "timeout" });
    await vi.advanceTimersByTimeAsync(100);
    await rejected;
    task.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("forbids automatic retries on mutation without explicit idempotency", () => {
    expect(() => createTask({ owner: null, execute: async () => 1, retry: { maxAttempts: 3 } }))
      .toThrow(ConfigurationError);
  });

  it("permits bounded retry when idempotency is explicitly asserted", async () => {
    vi.useFakeTimers();
    let attempts = 0;
    const task = createTask({ owner: null, idempotent: true, retry: { maxAttempts: 2, baseDelayMs: 5 },
      execute: async () => { if (++attempts === 1) throw new Error("retry"); return "saved"; }
    });
    const work = task.run("record");
    await vi.advanceTimersByTimeAsync(5);
    await expect(work).resolves.toBe("saved");
    expect(attempts).toBe(2);
    task.dispose();
  });

  it("handles repeated creation and disposal with no retained owners", async () => {
    const root = createOwner();
    for (let i = 0; i < 50; i++) {
      const task = createTask({ owner: root, execute: async () => i });
      expect(await task.run(undefined)).toBe(i);
      task.dispose();
    }
    disposeOwner(root);
    expect(root.disposed).toBe(true);
  });

  it("keeps native Promise semantics and does not patch global APIs", () => {
    const then = Promise.prototype.then;
    const nativeAbort = globalThis.AbortController;
    const nativeQueueMicrotask = globalThis.queueMicrotask;
    const task = createTask({ owner: null, execute: async () => 1 });
    expect(Promise.prototype.then).toBe(then);
    expect(globalThis.AbortController).toBe(nativeAbort);
    expect(globalThis.queueMicrotask).toBe(nativeQueueMicrotask);
    task.dispose();
  });
});
