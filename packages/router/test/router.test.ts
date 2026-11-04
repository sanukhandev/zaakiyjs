// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { createOwner, disposeOwner, onCleanup, provide, createContext } from "@zaakiyjs/core";
import { createRouter } from "../src/router.js";
import { createMemoryHistory } from "../src/history.js";
import { RedirectLoopError, UnsafeNavigationError } from "../src/types.js";
import type { RouteDefinition } from "../src/types.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}
function fixture(routes: readonly RouteDefinition[], initial = "/home") {
  const owner = createOwner();
  const history = createMemoryHistory(initial);
  const router = createRouter({ routes, owner, history });
  return { router, history, owner, dispose() { router.dispose(); disposeOwner(owner); } };
}
const home = { id: "home", path: "/home" } as const;

describe("navigation transactions", () => {
  it("supports push, replace, history traversal, query, hash and repeated navigation", async () => {
    const f = fixture([home, { id: "item", path: "/items/:id" }]);
    try {
      await f.router.start();
      expect((await f.router.navigate("/items/4?q=yes#more")).status).toBe("committed");
      expect(f.router.signals.params.value).toEqual({ id: "4" });
      expect(f.router.signals.search.value.get("q")).toBe("yes");
      expect(f.router.signals.hash.value).toBe("#more");
      expect(f.history.entries()).toHaveLength(2);
      expect((await f.router.navigate("/items/4?q=yes#more")).status).toBe("committed");
      expect(f.history.entries()).toHaveLength(2);
      await f.router.navigate("/items/5", { history: "replace" });
      expect(f.history.entries()).toEqual(["/home", "/items/5"]);
      f.router.back();
      await vi.waitFor(() => expect(f.router.signals.url.value).toBe("/home"));
      f.router.forward();
      await vi.waitFor(() => expect(f.router.signals.url.value).toBe("/items/5"));
    } finally { f.dispose(); }
  });

  it("runs guards in order, denies without route commitment, then redirects", async () => {
    const calls: string[] = [];
    const f = fixture([
      home,
      { id: "restricted", path: "/restricted", guard: () => { calls.push("deny"); return false; } },
      { id: "forward", path: "/forward", guard: () => { calls.push("redirect"); return { redirect: "/home?ok=1" }; } }
    ]);
    try {
      await f.router.start();
      expect((await f.router.navigate("/restricted")).status).toBe("blocked");
      expect(f.router.signals.url.value).toBe("/home");
      expect(f.router.signals.status.value).toBe("blocked");
      expect((await f.router.navigate("/forward")).url).toBe("/home?ok=1");
      expect(calls).toEqual(["deny", "redirect"]);
    } finally { f.dispose(); }
  });

  it("rejects redirects to external origins and redirect loops", async () => {
    const f = fixture([
      home,
      { id: "bad", path: "/bad", guard: () => ({ redirect: "https://evil.example" }) },
      { id: "loop", path: "/loop", guard: () => ({ redirect: "/loop" }) }
    ]);
    try {
      await f.router.start();
      await expect(f.router.navigate("/bad")).rejects.toThrow(UnsafeNavigationError);
      await expect(f.router.navigate("/loop")).rejects.toThrow(RedirectLoopError);
      expect(f.router.signals.url.value).toBe("/home");
    } finally { f.dispose(); }
  });

  it("never commits stale loader results after a superseding navigation", async () => {
    const slow = deferred<string>();
    const f = fixture([home, { id: "slow", path: "/slow", loader: () => slow.promise }, { id: "fast", path: "/fast" }]);
    try {
      await f.router.start();
      const first = f.router.navigate("/slow");
      await vi.waitFor(() => expect(f.router.signals.pending.value).toBe("/slow"));
      const second = f.router.navigate("/fast");
      expect((await second).status).toBe("committed");
      slow.resolve("obsolete");
      expect((await first).status).toBe("cancelled");
      expect(f.router.signals.url.value).toBe("/fast");
      expect(f.router.signals.matches.value.at(-1)?.data).toBeUndefined();
    } finally { f.dispose(); }
  });

  it("links owner disposal and explicit abort to the loader signal", async () => {
    const pending = deferred<void>();
    let observed: AbortSignal | undefined;
    let scopedOwner: ReturnType<typeof createOwner> | undefined;
    const f = fixture([home, { id: "wait", path: "/wait", loader: ctx => {
      observed = ctx.signal; scopedOwner = ctx.owner; return pending.promise;
    } }]);
    try {
      await f.router.start();
      const navigation = f.router.navigate("/wait");
      await vi.waitFor(() => expect(observed).toBeDefined());
      disposeOwner(scopedOwner!);
      expect(observed?.aborted).toBe(true);
      pending.resolve();
      expect((await navigation).status).toBe("cancelled");
      // A fresh pending navigation also supports explicit cancellation.
      const nextPending = deferred<void>();
      const original = f.router.signals.url.value;
      const againRouter = fixture([home, { id: "explicit", path: "/explicit", loader: () => nextPending.promise }]);
      try {
        await againRouter.router.start();
        const again = againRouter.router.navigate("/explicit");
        await vi.waitFor(() => expect(againRouter.router.signals.pending.value).toBe("/explicit"));
        againRouter.router.cancel();
        nextPending.resolve();
        expect((await again).status).toBe("cancelled");
        expect(againRouter.router.signals.url.value).toBe(original);
      } finally { againRouter.dispose(); }
    } finally { f.dispose(); }
  });

  it("deduplicates concurrent lazy imports and propagates loader failures", async () => {
    const module = deferred<{ loader: () => string }>();
    const lazy = vi.fn(() => module.promise);
    const f = fixture([home, { id: "lazy", path: "/lazy", lazy }]);
    try {
      await f.router.start();
      const a = f.router.navigate("/lazy");
      const b = f.router.navigate("/lazy");
      module.resolve({ loader: () => "loaded" });
      expect((await a).status).toBe("cancelled");
      expect((await b).status).toBe("committed");
      expect(f.router.signals.matches.value.at(-1)?.data).toBe("loaded");
      expect(lazy).toHaveBeenCalledTimes(1);
    } finally { f.dispose(); }
    const broken = fixture([home, { id: "broken", path: "/broken", loader: () => { throw new Error("load failed"); } }]);
    try {
      await broken.router.start();
      await expect(broken.router.navigate("/broken")).rejects.toThrow("load failed");
      expect(broken.router.signals.status.value).toBe("error");
    } finally { broken.dispose(); }
  });

  it("keeps application providers alive while disposing page scopes and listeners", async () => {
    const token = createContext<{ value: number }>("app");
    const cleanup = vi.fn();
    const f = fixture([home, { id: "other", path: "/other", loader: ctx => {
      expect(ctx.services.require(token).value).toBe(42);
      return 1;
    }, adapter: {
      setup: () => { onCleanup(cleanup); return undefined; },
      render: () => ({ node: document.createElement("section") })
    } }]);
    provide(f.owner, token, { value: 42 });
    const host = document.createElement("main");
    document.body.appendChild(host);
    f.router.attachOutlet(host);
    try {
      await f.router.start();
      await f.router.navigate("/other");
      expect(host.querySelector("section")).not.toBeNull();
      await f.router.navigate("/home");
      expect(cleanup).toHaveBeenCalledTimes(1);
      expect(host.querySelector("section")).toBeNull();
      expect(f.owner.disposed).toBe(false);
    } finally { f.dispose(); host.remove(); }
  });

  it("retains a parent layout while child route changes and tears child owners down once", async () => {
    const disposed = vi.fn();
    const f = fixture([{
      id: "layout", path: "/app", adapter: {
        render: () => {
          const node = document.createElement("main");
          const outlet = document.createElement("div");
          node.appendChild(outlet);
          return { node, outlet };
        }
      },
      children: [
        { id: "first", path: "a", adapter: {
          setup: () => { onCleanup(disposed); },
          render: () => ({ node: document.createElement("input") })
        } },
        { id: "second", path: "b", adapter: {
          render: () => ({ node: document.createElement("strong") })
        } }
      ]
    }], "/app/a");
    const host = document.createElement("div");
    document.body.appendChild(host);
    f.router.attachOutlet(host);
    try {
      await f.router.start();
      const layout = host.querySelector("main");
      const initial = host.querySelector("input");
      expect(layout).not.toBeNull();
      expect(initial).not.toBeNull();
      await f.router.navigate("/app/b");
      expect(host.querySelector("main")).toBe(layout);
      expect(host.querySelector("input")).toBeNull();
      expect(host.querySelector("strong")).not.toBeNull();
      expect(disposed).toHaveBeenCalledTimes(1);
    } finally { f.dispose(); host.remove(); }
  });

  it("is idempotent on start and cleans up history subscriptions on dispose", async () => {
    const history = createMemoryHistory("/home");
    const listen = vi.spyOn(history, "listen");
    const owner = createOwner();
    const router = createRouter({ routes: [home], owner, history });
    const a = router.start();
    const b = router.start();
    expect(a).toBe(b);
    await a;
    expect(listen).toHaveBeenCalledTimes(1);
    router.dispose();
    await expect(router.start()).rejects.toThrow("disposed");
    disposeOwner(owner);
  });

  it("matches not-found routes and blocks cross-base navigation", async () => {
    const owner = createOwner();
    const history = createMemoryHistory("/app/home");
    const router = createRouter({ owner, history, base: "/app", routes: [home, { id: "404", path: "*" }] });
    try {
      await router.start();
      expect((await router.navigate("/app/missing")).status).toBe("committed");
      expect(router.signals.matches.value.at(-1)?.route.id).toBe("404");
      await expect(router.navigate("/outside")).rejects.toThrow(UnsafeNavigationError);
    } finally { router.dispose(); disposeOwner(owner); }
  });
});
