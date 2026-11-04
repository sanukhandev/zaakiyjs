import { afterEach, describe, expect, it, vi } from "vitest";
import { createOwner, deactivateOwner, disposeOwner, mountOwner, runWithOwner } from "@zaakiyjs/core";
import { flushSync, signal } from "@zaakiyjs/signals";
import {
  CancellationError, ConfigurationError, TimeoutError, composeSignals,
  createResource, createResourceCache
} from "../src/index.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("read resources", () => {
  it("starts lazy by default and exposes readonly reactive state", async () => {
    const load = vi.fn(async () => 42);
    const resource = createResource({ load, owner: null });
    expect(load).not.toHaveBeenCalled();
    expect(resource.status.value).toBe("idle");
    expect(await resource.refresh()).toBe(42);
    expect(resource.data.value).toBe(42);
    expect(resource.lastSuccessful.value).toBe(42);
    expect(resource.pending.value).toBe(false);
    expect(resource.status.value).toBe("success");
    resource.dispose();
    await expect(resource.refresh()).rejects.toMatchObject({ code: "DISPOSED" });
  });

  it("executes eager loading and observes its rejection internally", async () => {
    const load = vi.fn(async () => { throw new Error("outage"); });
    const resource = createResource({ load, eager: true, owner: null });
    await vi.waitFor(() => expect(resource.status.value).toBe("error"));
    expect(resource.error.value).toMatchObject({ code: "RESOURCE_FAILED" });
    expect(resource.error.value?.cause).toBeInstanceOf(Error);
    resource.dispose();
  });

  it("distinguishes pending from refreshing and retains previous data", async () => {
    const next = deferred<number>();
    let count = 0;
    const resource = createResource({
      load: async () => ++count === 1 ? 10 : next.promise,
      keepPreviousData: true, owner: null
    });
    expect(await resource.refresh()).toBe(10);
    const pending = resource.refresh();
    expect(resource.pending.value).toBe(true);
    expect(resource.refreshing.value).toBe(true);
    expect(resource.data.value).toBe(10);
    next.resolve(20);
    await expect(pending).resolves.toBe(20);
    expect(resource.data.value).toBe(20);
    resource.dispose();
  });

  it("reacts to key transitions and suppresses stale results", async () => {
    const id = signal("a");
    const first = deferred<string>();
    const second = deferred<string>();
    const calls: string[] = [];
    const resource = createResource({
      key: () => id.value, owner: null, eager: true,
      load: ({ key }) => { calls.push(key); return key === "a" ? first.promise : second.promise; }
    });
    await vi.waitFor(() => expect(calls).toEqual(["a"]));
    id.value = "b";
    flushSync();
    await vi.waitFor(() => expect(calls).toEqual(["a", "b"]));
    second.resolve("new");
    await vi.waitFor(() => expect(resource.data.value).toBe("new"));
    first.resolve("stale");
    await Promise.resolve();
    expect(resource.data.value).toBe("new");
    resource.dispose();
  });

  it("does not allow a key changed before effect flushing to publish an old result", async () => {
    const key = signal(1);
    const pending = deferred<number>();
    const resource = createResource({ key: () => key.value, owner: null, load: () => pending.promise });
    const initial = resource.refresh();
    key.value = 2; // Effect is queued, but the Promise may settle first.
    pending.resolve(1);
    await expect(initial).rejects.toMatchObject({ kind: "superseded" });
    flushSync();
    resource.dispose();
  });

  it("does not run with null keys or disabled inputs", async () => {
    const key = signal<string | undefined>(undefined);
    const enabled = signal(false);
    const load = vi.fn(async ({ key }: { key: string; signal: AbortSignal; attempt: number }) => key);
    const resource = createResource({ key: () => key.value, enabled: () => enabled.value, eager: true, load, owner: null });
    await Promise.resolve();
    expect(load).not.toHaveBeenCalled();
    await expect(resource.refresh()).rejects.toBeInstanceOf(ConfigurationError);
    key.value = "x";
    enabled.value = true;
    flushSync();
    await vi.waitFor(() => expect(resource.data.value).toBe("x"));
    resource.dispose();
  });

  it("tracks array keys through a caller-defined equality comparator", async () => {
    const id = signal(1);
    const resource = createResource({
      key: () => ["item", id.value] as const,
      equalsKey: (a, b) => a?.[0] === b?.[0] && a?.[1] === b?.[1],
      load: async ({ key }) => key[1], eager: true, owner: null
    });
    await vi.waitFor(() => expect(resource.data.value).toBe(1));
    id.value = 2;
    flushSync();
    await vi.waitFor(() => expect(resource.data.value).toBe(2));
    resource.dispose();
  });

  it("propagates manual cancellation and rejects promptly", async () => {
    const source = deferred<number>();
    const resource = createResource({ load: () => source.promise, owner: null });
    const work = resource.refresh();
    resource.cancel();
    await expect(work).rejects.toMatchObject({ kind: "manual" });
    expect(resource.status.value).toBe("cancelled");
    source.resolve(10);
    await Promise.resolve();
    expect(resource.data.value).toBeUndefined();
    resource.dispose();
  });

  it("propagates AbortController cancellation to loader", async () => {
    const caller = new AbortController();
    let received: AbortSignal | undefined;
    const resource = createResource({
      signal: caller.signal, owner: null,
      load: ({ signal }) => { received = signal; return new Promise<number>(() => {}); }
    });
    const promise = resource.refresh();
    await vi.waitFor(() => expect(received).toBeDefined());
    caller.abort("leave");
    await expect(promise).rejects.toMatchObject({ kind: "caller", cause: "leave" });
    expect(received?.aborted).toBe(true);
    resource.dispose();
  });

  it("produces distinct timeouts without late writes", async () => {
    vi.useFakeTimers();
    const source = deferred<number>();
    const resource = createResource({ load: () => source.promise, timeoutMs: 30, owner: null });
    const operation = resource.refresh();
    const rejected = expect(operation).rejects.toBeInstanceOf(TimeoutError);
    await vi.advanceTimersByTimeAsync(30);
    await rejected;
    source.resolve(90);
    await Promise.resolve();
    expect(resource.data.value).toBeUndefined();
    resource.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancels on owner disposal and never publishes after disposal", async () => {
    const owner = createOwner();
    const source = deferred<number>();
    let received!: AbortSignal;
    const resource = runWithOwner(owner, () => createResource({
      load: ({ signal }) => { received = signal; return source.promise; }
    }));
    const work = resource.refresh();
    await vi.waitFor(() => expect(received).toBeDefined());
    disposeOwner(owner);
    await expect(work).rejects.toMatchObject({ kind: "owner" });
    source.resolve(4);
    await Promise.resolve();
    expect(resource.data.value).toBeUndefined();
    await expect(resource.refresh()).rejects.toMatchObject({ code: "DISPOSED" });
  });

  it("supports explicit owner injection and does not dispose on KeepAlive deactivation", async () => {
    const owner = createOwner();
    const resource = createResource({ owner, load: async () => 2 });
    mountOwner(owner);
    deactivateOwner(owner);
    expect(await resource.refresh()).toBe(2);
    disposeOwner(owner);
    await expect(resource.refresh()).rejects.toMatchObject({ code: "DISPOSED" });
  });

  it("does not leak listeners when composed signals settle", () => {
    const a = new AbortController();
    const b = new AbortController();
    const removeA = vi.spyOn(a.signal, "removeEventListener");
    const removeB = vi.spyOn(b.signal, "removeEventListener");
    const composed = composeSignals([a.signal, b.signal]);
    a.abort(new Error("caller"));
    expect(composed.signal.aborted).toBe(true);
    expect(composed.signal.reason).toBeInstanceOf(CancellationError);
    composed.dispose();
    expect(removeA).toHaveBeenCalled();
    expect(removeB).toHaveBeenCalled();
  });

  it("rejects invalid retry and timeout configurations", () => {
    expect(() => createResource({ owner: null, load: async () => 1, timeoutMs: 0 })).toThrow(ConfigurationError);
    expect(() => createResource({ owner: null, load: async () => 1, retry: { maxAttempts: 0 } })).toThrow(ConfigurationError);
  });

  it("retries reads with bounded backoff", async () => {
    vi.useFakeTimers();
    let attempts = 0;
    const r = createResource({
      owner: null,
      load: async () => {
        if (++attempts < 3) throw new Error("transient");
        return 5;
      },
      retry: { maxAttempts: 3, baseDelayMs: 10, jitter: 0 }
    });
    const work = r.refresh();
    await vi.advanceTimersByTimeAsync(30);
    await expect(work).resolves.toBe(5);
    expect(attempts).toBe(3);
    r.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("aborts retry delays and stops future attempts", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const load = vi.fn(async () => { throw new Error("unavailable"); });
    const r = createResource({ owner: null, signal: controller.signal, load, retry: { maxAttempts: 5, baseDelayMs: 1000 } });
    const work = r.refresh();
    await vi.advanceTimersByTimeAsync(1);
    controller.abort();
    await expect(work).rejects.toMatchObject({ kind: "caller" });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(load).toHaveBeenCalledTimes(1);
    r.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("scoped cache and shared in-flight work", () => {
  it("deduplicates work while one cancellation does not abort another consumer", async () => {
    const root = createOwner();
    const cache = createResourceCache({ owner: root });
    const source = deferred<number>();
    const loader = vi.fn(() => source.promise);
    const options = { owner: root, cache, cacheKey: () => "scope:item", load: loader };
    const a = createResource(options), b = createResource(options);
    const p1 = a.refresh(), p2 = b.refresh();
    await vi.waitFor(() => expect(loader).toHaveBeenCalledTimes(1));
    a.cancel();
    await expect(p1).rejects.toMatchObject({ kind: "manual" });
    source.resolve(7);
    await expect(p2).resolves.toBe(7);
    expect(b.data.value).toBe(7);
    disposeOwner(root);
  });

  it("uses fresh cache entries but revalidates after staleness", async () => {
    vi.useFakeTimers();
    const root = createOwner();
    const cache = createResourceCache({ owner: root, cacheTimeMs: 1000 });
    const load = vi.fn(async () => 9);
    const one = createResource({ owner: root, cache, cacheKey: () => "a", staleTimeMs: 50, load });
    expect(await one.refresh()).toBe(9);
    const two = createResource({ owner: root, cache, cacheKey: () => "a", staleTimeMs: 50, load, eager: true });
    await Promise.resolve(); await Promise.resolve();
    expect(two.data.value).toBe(9);
    expect(load).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60);
    two.invalidate();
    await vi.advanceTimersByTimeAsync(0);
    expect(load).toHaveBeenCalledTimes(2);
    disposeOwner(root);
  });

  it("evicts oldest cache entries under a hard limit", async () => {
    const root = createOwner();
    const cache = createResourceCache({ owner: root, maxEntries: 1 });
    const first = cache.acquire("one", async () => 1);
    expect(await first.promise).toBe(1);
    first.release();
    const second = cache.acquire("two", async () => 2);
    expect(await second.promise).toBe(2);
    second.release();
    expect(cache.size).toBe(1);
    expect(cache.get("one")).toBeUndefined();
    expect(cache.get<number>("two")?.value).toBe(2);
    disposeOwner(root);
  });

  it("enforces expiration and invalidation", async () => {
    vi.useFakeTimers();
    const root = createOwner();
    const cache = createResourceCache({ owner: root, cacheTimeMs: 10 });
    const lease = cache.acquire("one", async () => 1);
    await lease.promise; lease.release();
    expect(cache.get("one")?.value).toBe(1);
    await vi.advanceTimersByTimeAsync(11);
    expect(cache.get("one")).toBeUndefined();
    disposeOwner(root);
  });

  it("isolates application roots and simulated SSR requests", () => {
    const appA = createOwner();
    const appB = createOwner();
    const cache = createResourceCache({ owner: appA });
    expect(() => createResource({ owner: appB, cache, cacheKey: () => "tenant:user", load: async () => "private" }))
      .toThrow(ConfigurationError);
    expect(() => createResource({ owner: null, cache, cacheKey: () => "tenant:user", load: async () => "private" }))
      .toThrow(ConfigurationError);
    disposeOwner(appA);
    disposeOwner(appB);
    expect(cache.disposed).toBe(true);
  });

  it("requires an explicit private scope for standalone caches", () => {
    expect(() => createResourceCache({ owner: null })).toThrow(ConfigurationError);
    const scope = {};
    const cache = createResourceCache({ owner: null, scope });
    expect(() => createResource({ owner: null, cache, cacheKey: () => "x", load: async () => 1 }))
      .toThrow(ConfigurationError);
    const r = createResource({ owner: null, cache, cacheScope: scope, cacheKey: () => "x", load: async () => 1 });
    r.dispose(); cache.dispose();
  });

  it("does not retain producers after all consumers dispose", async () => {
    const root = createOwner();
    const cache = createResourceCache({ owner: root });
    const load = vi.fn(() => new Promise<number>(() => {}));
    const r = createResource({ owner: root, cache, cacheKey: () => "key", load });
    const work = r.refresh();
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(1));
    r.dispose();
    await expect(work).rejects.toMatchObject({ kind: "owner" });
    disposeOwner(root);
    expect(cache.disposed).toBe(true);
  });
});
