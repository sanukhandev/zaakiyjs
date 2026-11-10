---
title: "@zaakiyjs/core"
description: "Owner scopes, lifecycle, dependency injection, typed TSX contracts and control-flow intrinsics"
sidebar_position: 2
---

# @zaakiyjs/core

Use Core to bind resources, providers and component setup to deterministic application/route/component owners.

> **Availability:** Implemented source package in the repository, not a verified public npm release. All package manifests on the referenced commit are `0.0.0`; install from this workspace until independent publishing is approved.

## At a glance

- **Primary use:** Create a fresh owner per app or SSR request, register cleanup synchronously, and let DOM adapters dispose owners before removing nodes.
- **Runtime boundary:** See the package README and public export map before importing into browser/server code.
- **Source revision:** [9f6c6603c98c](https://github.com/sanukhandev/zaakiyjs/commit/9f6c6603c98ca566c2fed6fed34cc770f6a72960).

## Try it from the monorepo

```sh
pnpm --filter @zaakiyjs/core typecheck
pnpm --filter @zaakiyjs/core test
pnpm --filter @zaakiyjs/core build
```

## Feature usage: first working pattern

```ts
import { createOwner, createContext, provide, requireContext, runWithOwner, onCleanup, disposeOwner } from '@zaakiyjs/core';

interface Catalog { list(): string[] }
const CatalogKey = createContext<Catalog>('Catalog');
const app = createOwner();
provide(app, CatalogKey, { list: () => ['Books'] });
const feature = createOwner(app);
const names = runWithOwner(feature, () => {
  onCleanup(() => console.log('feature released'));
  return requireContext(feature, CatalogKey).list();
});
console.log(names);
disposeOwner(app);
```

## Usage and correctness guidelines

- `runWithOwner` provides a synchronous lexical scope only; it does not flow across `await`.
- `Show` and `For` are TSX compile-time intrinsics, not callable runtime components.
- `deactivateOwner`/`suspendOwner` label state, but do not automatically pause effects or cancel requests.

## Public API index

These are exported public symbols detected in `src/index.ts` at the source revision. Check types and package `exports` for supported subpaths and platform requirements.

- `Cleanup`
- `Component`
- `ComponentFactory`
- `ComputedSignal`
- `ContextToken`
- `EffectHandle`
- `EffectOptions`
- `For`
- `ForProps`
- `MissingProviderError`
- `OwnerScope`
- `OwnerState`
- `ReadonlySignal`
- `Show`
- `ShowProps`
- `Slot`
- `SlotProps`
- `ViewNode`
- `WritableSignal`
- `activateOwner`
- `createContext`
- `createOwner`
- `deactivateOwner`
- `disposeOwner`
- `executeComponent`
- `foundationStatus`
- `getOwner`
- `initializeOwnedComponent`
- `mountOwner`
- `onCleanup`
- `onMount`
- `ownDisposable`
- `ownEffect`
- `provide`
- `requireContext`
- `runWithOwner`
- `suspendOwner`
- `transferOwner`
- `useContext`

## Detailed feature guide

Sections below retain capability explanations and examples from the package's source README, not unimplemented proposals. Technical limitations inside a section remain applicable.

### Owners and lifecycle

```ts
import {
  createOwner, runWithOwner, onCleanup, onMount, mountOwner,
  disposeOwner, executeComponent, createContext, provide, requireContext
} from "@zaakiyjs/core";

const app = createOwner(); // A fresh owner per application or SSR request.
const route = createOwner(app);
const feature = createOwner(route);
const database = createContext<{ list(): Promise<string[]> }>("ProductRepository");

provide(app, database, { async list() { return ["A", "B"]; } });
runWithOwner(feature, () => {
  const repo = requireContext(feature, database); // Inherited, typed interface.
  void repo;
  onMount(() => { /* execute after DOM insertion */ });
  onCleanup(() => { /* release feature resources */ });
});
mountOwner(feature);
disposeOwner(app); // Child-first, last-registered cleanup first, once only.
```

`createOwner()` has no implicit current-owner parent: explicitly pass a parent, or obtain a new isolated root. `runWithOwner` sets a **synchronous** lexical owner; owner context never propagates across `await`, timers or Promise callbacks. `onCleanup` and `onMount` require a lexical owner. `mountOwner` executes mount hooks once and makes the owner active. Repeating it on an already active owner is a no-op, allowing DOM adapters to request a child mount without duplicating its lifecycle. When invoked on an application root, it mounts existing descendant scopes **child-first before ancestor callbacks** (after DOM insertion). Owners created dynamically after this point must be mounted explicitly. Callback errors dispose the affected subtree; errors during a descendant mount also dispose the application root. Disposal visits children in reverse creation order and callbacks in reverse registration order, continues after failures, and throws an AggregateError for multiple failures. The owner becomes disposed immediately, preventing new providers, children, effects and mount/cleanup registrations; **existing context providers remain readable inside disposal callbacks (which temporarily run under their **own disposing lexical owner**, never the scope that called `disposeOwner`)**, including inherited providers on a parent that is also disposing. Only after the last cleanup are provider maps cleared and parent references detached. After teardown, disposed-owner context lookup is rejected. Disposal is idempotent.

`deactivateOwner`, `suspendOwner`, and `activateOwner` only label lifecycle state. **They do not pause effects, cancel requests or implement KeepAlive.** An explicit `transferOwner` moves a nonroot scope within its existing application tree. Cross-root transfers and ancestor cycles are rejected. Providers are scope-local and immutable per token, child scopes can override, and provider entries are cleared on disposal. `useContext` returns undefined if missing; `requireContext` throws `MissingProviderError`. Service disposal is explicit through cleanup registrations.

`executeComponent(component, props, owner)` initializes a component exactly once for a fresh owner; reactive bindings live in `@zaakiyjs/dom` and will update independently of this setup function. An exception during setup disposes the owner. Resources with a `dispose()` method can be attached with `ownDisposable`. Use `ownEffect(() => effect(...))` to create a reactive effect **only** inside a live lexical owner and register the resulting `EffectHandle` for final disposal. `ownEffect` accepts the public signals effect factory as an argument, keeping Core independently testable while the Signals package is developed in parallel.

### Typed MVVM provider override

A ViewModel consumes a repository interface rather than importing a concrete service. An application default can be overridden for a feature or route without a process-global container:

```ts
import {
  createContext, createOwner, provide, requireContext, runWithOwner, onCleanup, disposeOwner
} from "@zaakiyjs/core";

interface ProductRepository { find(id: string): string }
const ProductRepositoryKey = createContext<ProductRepository>("ProductRepository");
const app = createOwner();
const page = createOwner(app);
const feature = createOwner(page);
provide(app, ProductRepositoryKey, { find: (id) => "remote:" + id });
provide(page, ProductRepositoryKey, { find: (id) => "mock:" + id });

function createProductViewModel(repo: ProductRepository) {
  return { label: (id: string) => repo.find(id) };
}
const vm = runWithOwner(feature, () => {
  const model = createProductViewModel(requireContext(feature, ProductRepositoryKey));
  onCleanup(() => { /* release feature-owned subscriptions/resources */ });
  return model;
});
void vm.label("123"); // "mock:123"
disposeOwner(app); // Child-first cleanup; provider maps are cleared.
```

Stateless views can remain plain components; no ViewModel class, singleton or automatic service disposal is required.

### TSX and compiler ABI

Set `"jsx": "preserve"` and `"jsxImportSource": "@zaakiyjs/core"`. JSX types cover TypeScript's HTML/SVG tag maps, typed event callbacks, nullable-on-unmount element refs, common attributes, data and ARIA attributes, and selected element-specific props. There is **no** `jsx/jsxs/jsxDEV` runtime: executable TSX requires the separate Zaakiy compiler/DOM integration. DOM/compiler agents should invoke `executeComponent` on a new child owner; call `mountOwner` only after insertion, and dispose the tree before detaching nodes.

### Typed compiler-only control flow (M1)

Import `Show` and `For` from `@zaakiyjs/core` inside TSX source compiled by `@zaakiyjs/compiler`:

```tsx
import { Show, For } from "@zaakiyjs/core";
import { signal } from "@zaakiyjs/signals";

const active = signal(true);
const tasks = signal([{ id: 1, title: "Ship" }]);
function Tasks() {
  return <main>
    <Show when={active.value} fallback={<p>Paused</p>}>
      <p>Active</p>
    </Show>
    <ul>
      <For each={tasks.value} by={task => task.id}>
        {task => <li>{task.title}</li>}
      </For>
    </ul>
  </main>;
}
```

These exported functions are **compile-time intrinsics**, not runtime JSX components; direct invocation intentionally throws. The compiler lowers to DOM ABI v1 `ConditionalBlock`/`KeyedLoop`, preserving per-item owner and signal identity. A single native child/root is required for the restricted M1 authoring slice. `by` accepts an inline arrow or named function reference returning a primitive key. Use a wrapping native element around nested regions. See [ADR 0005](../../adr/0005-tsx-control-flow-intrinsics.md) for diagnostics, unsupported syntax and browser gates.

## Integrate with neighboring packages

- [@zaakiyjs/signals](./signals.md)
- [@zaakiyjs/dom](./dom.md)
- [@zaakiyjs/store](./store.md)
- [@zaakiyjs/router](./router.md)

## Source and maintenance

- [Package README](https://github.com/sanukhandev/zaakiyjs/blob/9f6c6603c98ca566c2fed6fed34cc770f6a72960/packages/core/README.md)
- [Public exports](https://github.com/sanukhandev/zaakiyjs/blob/9f6c6603c98ca566c2fed6fed34cc770f6a72960/packages/core/src/index.ts)
- [Package tests](https://github.com/sanukhandev/zaakiyjs/tree/9f6c6603c98ca566c2fed6fed34cc770f6a72960/packages/core/test) (some packages use `tests/`)
- Update this guide in the same PR that changes public APIs, compiler/DOM behavior, security rules or feature support.
