import { describe, expect, it, vi } from "vitest";
import type { EffectHandle } from "@zaakiyjs/signals";
import {
  activateOwner, createContext, createOwner, deactivateOwner, disposeOwner,
  executeComponent, getOwner, initializeOwnedComponent, mountOwner,
  MissingProviderError, onCleanup, onMount, ownDisposable, ownEffect, provide, requireContext,
  runWithOwner, suspendOwner, transferOwner, useContext
} from "../src/index.js";
import type { ViewNode } from "../src/index.js";
import { getOwnerProviders } from "../src/owner.js";

describe("owner-scoped lifecycle", () => {
  it("creates independent roots and restores lexical context", () => {
    const a = createOwner();
    const b = createOwner();
    expect(a.parent).toBeNull();
    expect(b.parent).toBeNull();
    expect(getOwner()).toBeNull();
    runWithOwner(a, () => {
      expect(getOwner()).toBe(a);
      runWithOwner(b, () => expect(getOwner()).toBe(b));
      expect(getOwner()).toBe(a);
    });
    expect(getOwner()).toBeNull();
    disposeOwner(a);
    disposeOwner(b);
  });

  it("cleans children first, newest siblings first, callbacks in LIFO order", () => {
    const order: string[] = [];
    const root = createOwner();
    const a = createOwner(root);
    const b = createOwner(root);
    runWithOwner(root, () => {
      onCleanup(() => order.push("root-1"));
      onCleanup(() => order.push("root-2"));
    });
    runWithOwner(a, () => onCleanup(() => order.push("a")));
    runWithOwner(b, () => onCleanup(() => order.push("b")));
    disposeOwner(root);
    expect(order).toEqual(["b", "a", "root-2", "root-1"]);
    expect(root.disposed).toBe(true);
    expect(a.disposed).toBe(true);
    expect(b.disposed).toBe(true);
    expect(a.parent).toBeNull(); // A retained disposed child cannot retain root providers.
    expect(b.parent).toBeNull();
  });

  it("is idempotent and rejects late registration and child creation", () => {
    const root = createOwner();
    const cleanup = vi.fn();
    runWithOwner(root, () => onCleanup(cleanup));
    disposeOwner(root);
    disposeOwner(root);
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(() => createOwner(root)).toThrow(/disposed/);
    expect(() => runWithOwner(root, () => onCleanup(() => {}))).toThrow(/disposed/);
    expect(() => provide(root, createContext<number>(), 1)).toThrow(/disposed/);
  });

  it("restores lexical owner and safely disposes after setup throws", () => {
    const root = createOwner();
    const child = createOwner(root);
    const cleanup = vi.fn();
    expect(() => initializeOwnedComponent(child, () => {
      onCleanup(cleanup);
      throw new Error("setup failed");
    })).toThrow("setup failed");
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(getOwner()).toBeNull();
    expect(root.disposed).toBe(false);
    expect(child.disposed).toBe(true);
    disposeOwner(root);
  });

  it("continues cleanup when callbacks throw and aggregates failures", () => {
    const root = createOwner();
    const called = vi.fn();
    runWithOwner(root, () => {
      onCleanup(called);
      onCleanup(() => { throw new Error("first"); });
      onCleanup(() => { throw new Error("second"); });
    });
    expect(() => disposeOwner(root)).toThrow(AggregateError);
    expect(called).toHaveBeenCalledTimes(1);
    expect(() => disposeOwner(root)).not.toThrow();
  });

  it("runs mount callbacks once and transitions through active states", () => {
    const root = createOwner();
    const states: string[] = [];
    runWithOwner(root, () => {
      onMount(() => states.push(root.state));
      onCleanup(() => states.push("cleanup"));
    });
    mountOwner(root);
    expect(states).toEqual(["mounted"]);
    expect(root.state).toBe("active");
    expect(() => mountOwner(root)).not.toThrow();
    deactivateOwner(root);
    expect(root.state).toBe("deactivated");
    activateOwner(root);
    suspendOwner(root);
    expect(root.state).toBe("suspended");
    activateOwner(root);
    expect(root.state).toBe("active");
    disposeOwner(root);
    expect(states).toEqual(["mounted", "cleanup"]);
    expect(root.state).toBe("disposed");
  });

  it("mounts nested route, feature and component owners before their ancestors", () => {
    const order: string[] = [];
    const app = createOwner();
    const route = createOwner(app);
    const feature = createOwner(route);
    const component = createOwner(feature);
    for (const [label, owner] of [
      ["app", app], ["route", route], ["feature", feature], ["component", component]
    ] as const) {
      runWithOwner(owner, () => onMount(() => order.push(label)));
    }
    mountOwner(app);
    expect(order).toEqual(["component", "feature", "route", "app"]);
    for (const owner of [app, route, feature, component]) expect(owner.state).toBe("active");
    expect(() => mountOwner(component)).not.toThrow();
    disposeOwner(app);
  });

  it("disposes the whole application when a descendant mount callback fails", () => {
    const app = createOwner();
    const child = createOwner(app);
    const appCleanup = vi.fn();
    const childCleanup = vi.fn();
    runWithOwner(app, () => onCleanup(appCleanup));
    runWithOwner(child, () => {
      onCleanup(childCleanup);
      onMount(() => { throw new Error("child failed"); });
    });
    expect(() => mountOwner(app)).toThrow("child failed");
    expect(app.disposed).toBe(true);
    expect(child.disposed).toBe(true);
    expect(childCleanup).toHaveBeenCalledOnce();
    expect(appCleanup).toHaveBeenCalledOnce();
  });

  it("requires explicit mount for owners added after initial application mount", () => {
    const app = createOwner();
    mountOwner(app);
    const dynamic = createOwner(app);
    const onDynamicMount = vi.fn();
    runWithOwner(dynamic, () => onMount(onDynamicMount));
    expect(dynamic.state).toBe("created");
    expect(onDynamicMount).not.toHaveBeenCalled();
    mountOwner(dynamic);
    expect(onDynamicMount).toHaveBeenCalledOnce();
    disposeOwner(app);
  });

  it("disposes after a failing mount hook without leaving partial state", () => {
    const root = createOwner();
    const cleanup = vi.fn();
    runWithOwner(root, () => {
      onMount(() => { throw new Error("failed mount"); });
      onCleanup(cleanup);
    });
    expect(() => mountOwner(root)).toThrow("failed mount");
    expect(cleanup).toHaveBeenCalledOnce();
    expect(root.disposed).toBe(true);
  });

  it("does not propagate lexical owner through asynchronous continuations", async () => {
    const root = createOwner();
    const continuation = runWithOwner(root, async () => {
      expect(getOwner()).toBe(root);
      await Promise.resolve();
      return getOwner();
    });
    expect(await continuation).toBeNull();
    disposeOwner(root);
  });

  it("explicit handoff stays inside the application root and prevents cycles", () => {
    const root = createOwner();
    const left = createOwner(root);
    const right = createOwner(root);
    const child = createOwner(left);
    transferOwner(child, right);
    expect(child.parent).toBe(right);
    expect(() => transferOwner(right, child)).toThrow(/cycle/);
    expect(() => transferOwner(root, right)).toThrow(/root owner/);
    const otherRoot = createOwner();
    expect(() => transferOwner(child, otherRoot)).toThrow(/application roots/);
    disposeOwner(root);
    disposeOwner(otherRoot);
    expect(child.disposed).toBe(true);
  });
});

describe("scope-local typed context", () => {
  interface Repository { find(id: string): string }
  const RepositoryToken = createContext<Repository>("Repository");

  it("inherits providers with nearest scope override through interfaces", () => {
    const root = createOwner();
    const feature = createOwner(root);
    const component = createOwner(feature);
    provide(root, RepositoryToken, { find: id => "remote-" + id });
    const local: Repository = { find: id => "local-" + id };
    provide(feature, RepositoryToken, local);
    expect(requireContext(component, RepositoryToken).find("42")).toBe("local-42");
    expect(requireContext(root, RepositoryToken).find("42")).toBe("remote-42");
    expect(() => provide(feature, RepositoryToken, local)).toThrow(/already registered/);
    disposeOwner(root);
  });

  it("retains inherited providers during child-only cleanup without allowing registrations", () => {
    const app = createOwner();
    const child = createOwner(app);
    const release = vi.fn();
    const token = createContext<{ release(): void }>("Repository");
    provide(app, token, { release });
    runWithOwner(child, () => onCleanup(() => {
      expect(child.disposed).toBe(true);
      expect(child.parent).toBe(app);
      expect(requireContext(child, token).release).toBe(release);
      expect(() => provide(child, token, { release })).toThrow(/disposed/);
      expect(() => createOwner(child)).toThrow(/disposed/);
      expect(() => runWithOwner(child, () => onCleanup(() => {}))).toThrow(/disposed/);
      requireContext(child, token).release();
    }));
    disposeOwner(child);
    expect(release).toHaveBeenCalledOnce();
    expect(child.parent).toBeNull();
    expect(() => requireContext(child, token)).toThrow(/disposed/);
    expect(requireContext(app, token).release).toBe(release);
    disposeOwner(app);
  });

  it("retains ancestor and shadowed providers through complete application teardown", () => {
    const order: string[] = [];
    const app = createOwner();
    const feature = createOwner(app);
    const component = createOwner(feature);
    const token = createContext<{ release(): void }>("ScopedResource");
    provide(app, token, { release: () => order.push("app-resource") });
    provide(feature, token, { release: () => order.push("feature-resource") });
    runWithOwner(component, () => onCleanup(() => {
      expect(component.disposed).toBe(true);
      expect(feature.disposed).toBe(true);
      expect(app.disposed).toBe(true);
      expect(component.parent).toBe(feature);
      requireContext(component, token).release();
      expect(() => provide(app, token, { release: () => {} })).toThrow(/disposed/);
    }));
    runWithOwner(feature, () => onCleanup(() => {
      requireContext(feature, token).release();
    }));
    runWithOwner(app, () => onCleanup(() => {
      requireContext(app, token).release();
    }));
    disposeOwner(app);
    expect(order).toEqual(["feature-resource", "feature-resource", "app-resource"]);
    expect(app.parent).toBeNull();
    expect(feature.parent).toBeNull();
    expect(component.parent).toBeNull();
    for (const owner of [app, feature, component]) {
      expect(getOwnerProviders(owner).size).toBe(0);
      expect(() => requireContext(owner, token)).toThrow(/disposed/);
    }
  });

  it("continues provider-aware cleanup after failures and handles reentrant disposal", () => {
    const app = createOwner();
    const child = createOwner(app);
    const token = createContext<{ release(): void }>("RecoveryResource");
    const release = vi.fn();
    provide(app, token, { release });
    runWithOwner(child, () => {
      onCleanup(() => {
        disposeOwner(child);
        disposeOwner(app);
        requireContext(child, token).release();
      });
      onCleanup(() => { throw new Error("failed cleanup"); });
    });
    expect(() => disposeOwner(app)).toThrow("failed cleanup");
    expect(release).toHaveBeenCalledOnce();
    expect(child.parent).toBeNull();
    expect(child.disposed).toBe(true);
    expect(app.disposed).toBe(true);
    expect(getOwnerProviders(app).size).toBe(0);
    expect(() => disposeOwner(app)).not.toThrow();
  });

  it("returns undefined or typed missing-provider error", () => {
    const root = createOwner();
    expect(useContext(root, RepositoryToken)).toBeUndefined();
    expect(() => requireContext(root, RepositoryToken)).toThrow(MissingProviderError);
    disposeOwner(root);
  });

  it("releases provider references even when disposed owners remain reachable", () => {
    const root = createOwner();
    const child = createOwner(root);
    const token = createContext<{ readonly value: string }>("ScopedService");
    const service = { value: "instance" };
    provide(root, token, service);
    const stored = getOwnerProviders(root);
    expect(stored.size).toBe(1);
    expect(requireContext(child, token)).toBe(service);
    disposeOwner(root);
    expect(stored.size).toBe(0);
    expect(child.parent).toBeNull();
    expect(() => requireContext(child, token)).toThrow(/disposed/);
  });

  it("isolates applications and simulated SSR requests", () => {
    const token = createContext<{ user: string }>("RequestIdentity");
    const requestA = createOwner();
    const requestB = createOwner();
    provide(requestA, token, { user: "A" });
    provide(requestB, token, { user: "B" });
    expect(requireContext(createOwner(requestA), token).user).toBe("A");
    expect(requireContext(createOwner(requestB), token).user).toBe("B");
    disposeOwner(requestA);
    expect(requireContext(requestB, token).user).toBe("B");
    disposeOwner(requestB);
  });
});

describe("component and resource integration", () => {
  it("initializes each component owner exactly once without rerendering", () => {
    const root = createOwner();
    const componentOwner = createOwner(root);
    const call = vi.fn((props: Readonly<{ label: string }>) => { void props; return {} as ViewNode; });
    executeComponent(call, { label: "A" }, componentOwner);
    expect(call).toHaveBeenCalledTimes(1);
    expect(() => executeComponent(call, { label: "B" }, componentOwner)).toThrow(/already initialized/);
    expect(call).toHaveBeenCalledTimes(1);
    disposeOwner(root);
  });

  it("adopts disposable signals effect handles and disposes them once", () => {
    const root = createOwner();
    const handle: EffectHandle = { dispose: vi.fn() };
    runWithOwner(root, () => ownDisposable(handle));
    disposeOwner(root);
    disposeOwner(root);
    expect(handle.dispose).toHaveBeenCalledTimes(1);
  });

  it("rejects effect factories without a live owner and disposes after unmount", () => {
    const create = vi.fn(() => ({ dispose: vi.fn() }));
    expect(() => ownEffect(create)).toThrow(/requires runWithOwner/);
    expect(create).not.toHaveBeenCalled();
    const owner = createOwner();
    const owned = runWithOwner(owner, () => ownEffect(create));
    expect(create).toHaveBeenCalledOnce();
    disposeOwner(owner);
    expect(owned.dispose).toHaveBeenCalledOnce();
    expect(() => runWithOwner(owner, () => ownEffect(create))).toThrow(/disposed/);
    expect(create).toHaveBeenCalledOnce();
  });

  it("disposes an effect that invalidates its owner during initial creation", () => {
    const owner = createOwner();
    const dispose = vi.fn();
    expect(() => runWithOwner(owner, () => ownEffect(() => {
      disposeOwner(owner);
      return { dispose };
    }))).toThrow(/disposed/);
    expect(dispose).toHaveBeenCalledOnce();
  });

  it("does not leak a resource when adoption is attempted outside an owner", () => {
    const handle = { dispose: vi.fn() };
    expect(() => ownDisposable(handle)).toThrow(/requires runWithOwner/);
    expect(handle.dispose).toHaveBeenCalledOnce();
  });

  it("does not retain resources after disposal across successive route scopes", () => {
    const app = createOwner();
    const releases = Array.from({ length: 100 }, () => vi.fn());
    for (const release of releases) {
      const route = createOwner(app);
      runWithOwner(route, () => onCleanup(release));
      disposeOwner(route);
    }
    expect(releases.every(release => release.mock.calls.length === 1)).toBe(true);
    disposeOwner(app);
    expect(releases.every(release => release.mock.calls.length === 1)).toBe(true);
  });
});
