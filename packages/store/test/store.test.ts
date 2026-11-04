import { describe, expect, it, vi } from "vitest";
import { createOwner, disposeOwner, onCleanup, provide, runWithOwner } from "@zaakiyjs/core";
import type { OwnerScope } from "@zaakiyjs/core";
import { batch, effect, flushSync, signal } from "@zaakiyjs/signals";
import {
  createStore, createStoreContext, getOrCreateRootStore, provideStore,
  requireStore, useStore
} from "../src/index.js";

function setup(owner = createOwner()) {
  const store = createStore({
    owner,
    state: () => ({ count: 0, other: 10, active: true, profile: { name: "A", tags: ["one"] } }),
    actions: ({ get, set, update, patch }) => {
      const increment = (by: number) => update("count", old => old + by);
      return {
        increment,
        twice(by: number) { increment(by); increment(by); },
        replaceName(name: string) { set("profile", { ...get("profile"), name, tags: [...get("profile").tags] }); },
        toggle() { set("active", !get("active")); },
        patchBoth() { patch({ count: 7, other: 11 }); },
        failAfterWrite() { set("count", 99); throw new Error("action failed"); },
        invalidPatch() { patch({ count: 5, profile: new Date() as unknown as { name: string; tags: string[] } }); },
        onlyOther() { set("other", get("other") + 1); }
      };
    }
  });
  return { owner, store };
}

describe("@zaakiyjs/store", () => {
  it("creates isolated immutable fields with a stable store and action identity", () => {
    const { owner, store } = setup();
    expect(store.state.count.value).toBe(0);
    expect(store.actions).toBe(store.actions);
    expect(store.state).toBe(store.state);
    expect(Object.isFrozen(store.state.profile.value)).toBe(true);
    expect(Object.isFrozen(store.state.profile.value.tags)).toBe(true);
    expect(Reflect.set(store.state, "count", 123)).toBe(false);
    expect(Reflect.set(store.state.profile.value, "name", "injected")).toBe(false);
    store.actions.increment(2);
    expect(store.state.count.value).toBe(2);
    disposeOwner(owner);
  });

  it("copies initial inputs and write arguments rather than retaining mutable references", () => {
    const owner = createOwner();
    const external = { entries: [{ id: "a" }] };
    const store = createStore({ owner, state: { data: external }, actions: ({ set }) => ({ replace(data: typeof external) { set("data", data); } }) });
    external.entries[0]!.id = "changed";
    expect(store.state.data.value.entries[0]?.id).toBe("a");
    const next = { entries: [{ id: "b" }] };
    store.actions.replace(next);
    next.entries[0]!.id = "tampered";
    expect(store.state.data.peek().entries[0]?.id).toBe("b");
    disposeOwner(owner);
  });

  it("creates lazy, memoized computed selectors without unrelated field updates", () => {
    const { owner, store } = setup();
    const evaluate = vi.fn((state: typeof store.state) => state.count.value * 2);
    const derived = store.select(evaluate);
    expect(evaluate).toHaveBeenCalledTimes(0);
    expect(derived.value).toBe(0);
    expect(derived.peek()).toBe(0);
    expect(evaluate).toHaveBeenCalledTimes(1);
    const readings: number[] = [];
    const watch = effect(() => { readings.push(derived.value); });
    store.actions.onlyOther();
    flushSync();
    expect(readings).toEqual([0]);
    store.actions.increment(3);
    flushSync();
    expect(readings).toEqual([0, 6]);
    expect(evaluate).toHaveBeenCalledTimes(2);
    watch.dispose();
    disposeOwner(owner);
  });

  it("switches dynamic dependencies and detaches stale branches", () => {
    const { owner, store } = setup();
    const selected = store.select(state => state.active.value ? state.count.value : state.other.value);
    const readings: number[] = [];
    const stop = effect(() => { readings.push(selected.value); });
    store.actions.onlyOther();
    flushSync();
    expect(readings).toEqual([0]);
    store.actions.toggle();
    flushSync();
    expect(readings).toEqual([0, 11]);
    store.actions.increment(6);
    flushSync();
    expect(readings).toEqual([0, 11]);
    store.actions.onlyOther();
    flushSync();
    expect(readings).toEqual([0, 11, 12]);
    stop.dispose();
    disposeOwner(owner);
  });

  it("deduplicates synchronous updates and nested actions via Signals.batch", () => {
    const { owner, store } = setup();
    const readings: number[] = [];
    const stop = effect(() => { readings.push(store.state.count.value); });
    store.actions.twice(2);
    flushSync();
    expect(readings).toEqual([0, 4]);
    batch(() => { store.actions.increment(1); store.actions.increment(2); });
    flushSync();
    expect(readings).toEqual([0, 4, 7]);
    store.actions.patchBoth();
    flushSync();
    expect(store.state.other.value).toBe(11);
    stop.dispose();
    disposeOwner(owner);
  });

  it("propagates action failures with committed partial updates and no rollback claim", () => {
    const { owner, store } = setup();
    const seen: number[] = [];
    const stop = effect(() => { seen.push(store.state.count.value); });
    expect(() => store.actions.failAfterWrite()).toThrow("action failed");
    flushSync();
    expect(store.state.count.value).toBe(99);
    expect(seen).toEqual([0, 99]);
    expect(() => store.actions.invalidPatch()).toThrow(/plain objects/);
    expect(store.state.count.value).toBe(99);
    stop.dispose();
    disposeOwner(owner);
  });

  it("resets nested fields to a captured immutable initial state", () => {
    const { owner, store } = setup();
    store.actions.increment(12);
    store.actions.replaceName("B");
    expect(store.state.profile.value.name).toBe("B");
    store.reset();
    expect(store.state.count.peek()).toBe(0);
    expect(store.state.profile.value.name).toBe("A");
    expect(store.state.profile.value.tags).toEqual(["one"]);
    disposeOwner(owner);
  });

  it("rejects unknown keys, getters, cycles, methods and invalid non-plain state", () => {
    const root = createOwner();
    expect(() => createStore({ owner: root, state: { time: new Date() }, actions: () => ({}) })).toThrow(/plain objects/);
    const cycle: { next?: unknown } = {}; cycle.next = cycle;
    expect(() => createStore({ owner: root, state: { cycle }, actions: () => ({}) })).toThrow(/Cyclic/);
    expect(() => createStore({ owner: root, state: { broken: { get bad() { throw Error("getter executed"); } } }, actions: () => ({}) })).toThrow(/accessors/);
    expect(() => createStore({ owner: root, state: { rows: Array(2) }, actions: () => ({}) })).toThrow(/Sparse/);
    disposeOwner(root);
  });

  it("rejects writes captured outside actions and cleans up a manually disposed store", () => {
    const owner = createOwner();
    let leakedWrite!: () => void;
    const store = createStore({ owner, state: { count: 0 }, actions: ({ set }) => {
      leakedWrite = () => set("count", 1);
      return { increase() { set("count", 2); } };
    } });
    expect(() => leakedWrite()).toThrow(/declared action/);
    store.actions.increase();
    store.dispose();
    expect(store.disposed).toBe(true);
    expect(() => store.state.count.value).toThrow(/disposed/);
    expect(() => store.actions.increase()).toThrow(/disposed/);
    expect(() => store.reset()).toThrow(/disposed/);
    disposeOwner(owner);
  });

  it("disposes a selector's owned observer on component teardown", () => {
    const root = createOwner();
    const child = createOwner(root);
    const { store } = setup(root);
    const external = signal(0);
    const selected = store.select(s => s.count.value + external.value);
    const observed: number[] = [];
    runWithOwner(child, () => {
      const handle = effect(() => { observed.push(selected.value); });
      onCleanup(() => handle.dispose());
    });
    expect(observed).toEqual([0]);
    disposeOwner(child);
    const inbound = external as unknown as { readonly observers: ReadonlySet<unknown> };
    expect(inbound.observers.size).toBe(0);
    store.actions.increment(1);
    external.value++;
    flushSync();
    expect(observed).toEqual([0]);
    disposeOwner(root);
  });

  it("repeated owner mount/dispose does not retain external subscriptions", () => {
    const source = signal(0);
    for (let i = 0; i < 100; i++) {
      const root = createOwner();
      const store = createStore({ owner: root, state: { count: 0 }, actions: ({ set }) => ({ increase() { set("count", 1); } }) });
      const selector = store.select(state => state.count.value + source.value);
      const stop = effect(() => { void selector.value; });
      runWithOwner(root, () => { onCleanup(() => stop.dispose()); });
      disposeOwner(root);
      expect(store.disposed).toBe(true);
      expect((source as unknown as { readonly observers: ReadonlySet<unknown> }).observers.size).toBe(0);
    }
  });

  it("composes nested wrapped actions without duplicate notifications", () => {
    const owner = createOwner();
    let invokeInner = () => {};
    const store = createStore({
      owner,
      state: { value: 0 },
      actions: ({ get, set }) => ({
        inner() { set("value", get("value") + 1); },
        outer() { invokeInner(); invokeInner(); }
      })
    });
    invokeInner = () => store.actions.inner();
    const observed: number[] = [];
    const stop = effect(() => { observed.push(store.state.value.value); });
    store.actions.outer();
    flushSync();
    expect(observed).toEqual([0, 2]);
    stop.dispose();
    disposeOwner(owner);
  });

  it("supports real component, feature and route store lifetimes", () => {
    const app = createOwner();
    const route = createOwner(app);
    const feature = createOwner(route);
    const screen = createOwner(feature);
    const sibling = createOwner(route);
    const make = (owner: OwnerScope, name: string) => createStore({
      owner,
      state: { name },
      actions: ({ set }) => ({ rename(value: string) { set("name", value); } })
    });
    const token = createStoreContext<ReturnType<typeof make>>("ScopedProfile");
    const rootStore = make(app, "global");
    const featureStore = make(feature, "feature");
    provideStore(app, token, rootStore);
    provideStore(feature, token, featureStore);
    expect(requireStore(screen, token)).toBe(featureStore);
    expect(requireStore(sibling, token)).toBe(rootStore);
    featureStore.actions.rename("feature-2");
    expect(rootStore.state.name.value).toBe("global");
    disposeOwner(feature);
    expect(featureStore.disposed).toBe(true);
    expect(rootStore.disposed).toBe(false);
    expect(requireStore(sibling, token).state.name.value).toBe("global");
    disposeOwner(app);
  });

  it("supports route and feature overrides without cross-feature leakage", () => {
    const app = createOwner();
    const route = createOwner(app);
    const feature = createOwner(route);
    const sibling = createOwner(route);
    const token = createStoreContext<{ read(): string }>("feature catalog");
    provideStore(app, token, { read: () => "app" });
    provideStore(feature, token, { read: () => "feature" });
    expect(requireStore(feature, token).read()).toBe("feature");
    expect(requireStore(sibling, token).read()).toBe("app");
    expect(useStore(app, token)?.read()).toBe("app");
    disposeOwner(app);
  });

  it("creates exactly one root-owned store per independent application", () => {
    const appA = createOwner();
    const appB = createOwner();
    const nestedA = createOwner(appA);
    const token = createStoreContext<ReturnType<typeof setup>["store"]>("counter");
    const factory = vi.fn((root: OwnerScope) => setup(root).store);
    const first = getOrCreateRootStore(nestedA, token, factory);
    expect(getOrCreateRootStore(appA, token, factory)).toBe(first);
    const second = getOrCreateRootStore(appB, token, factory);
    expect(first).not.toBe(second);
    expect(factory).toHaveBeenCalledTimes(2);
    first.actions.increment(1);
    expect(second.state.count.value).toBe(0);
    disposeOwner(appA);
    expect(first.disposed).toBe(true);
    expect(second.disposed).toBe(false);
    disposeOwner(appB);
  });

  it("keeps SSR request data isolated even when sharing token and factory", () => {
    const token = createStoreContext<ReturnType<typeof setup>["store"]>("SSR counter");
    const makeRequest = () => {
      const request = createOwner();
      const store = getOrCreateRootStore(request, token, root => setup(root).store);
      return { request, store };
    };
    const a = makeRequest();
    const b = makeRequest();
    a.store.actions.increment(5);
    expect(b.store.state.count.peek()).toBe(0);
    disposeOwner(a.request);
    expect(b.store.state.count.value).toBe(0);
    disposeOwner(b.request);
  });

  it("uses owned context providers and rejects mismatched root ownership", () => {
    const app = createOwner();
    const other = createOwner();
    const token = createStoreContext<ReturnType<typeof setup>["store"]>("OwnedStore");
    provide(app, token, setup(other).store);
    expect(() => getOrCreateRootStore(app, token, root => setup(root).store)).toThrow(/wrong owner/);
    disposeOwner(app); disposeOwner(other);
  });
});
