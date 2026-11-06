---
title: "@zaakiyjs/store"
description: "Owner-scoped immutable application state, explicit actions and computed selectors"
sidebar_position: 8
---

# @zaakiyjs/store

Use Store to share state through scoped ViewModel ports while preserving fine-grained Signals reactivity.

> **Availability:** Source implementation in ZaakiyJS, not a verified published npm release. The package's manifest at the referenced revision uses `0.0.0`; use workspace tooling until independent publishing is approved.

## At a glance

- **Use it when:** Choose a store for shared domain slices; prefer local `signal()` for one-component state.
- **Reference revision:** [9f6c6603c98c](https://github.com/sanukhandev/zaakiyjs/commit/9f6c6603c98ca566c2fed6fed34cc770f6a72960).

## Try it in the monorepo

```sh
pnpm --filter @zaakiyjs/store typecheck
pnpm --filter @zaakiyjs/store test
pnpm --filter @zaakiyjs/store build
```

## Feature usage: first working pattern

```ts
import { createOwner, runWithOwner, disposeOwner } from '@zaakiyjs/core';
import { createStore } from '@zaakiyjs/store';

const owner = createOwner();
const cart = runWithOwner(owner, () => createStore({
  state: { quantity: 0 },
  actions: ({ update }) => ({
    add(by: number) { update('quantity', value => value + by); }
  })
}));
const doubled = cart.select(state => state.quantity.value * 2);
cart.actions.add(3);
console.log(doubled.value); // 6
disposeOwner(owner);
```

## Usage and correctness guidelines

- State fields are deep-frozen plain data; replace fields instead of mutating nested objects.
- Store writes are only allowed inside declared synchronous actions and are batched; an action is not a transaction with rollback.
- Use `getOrCreateRootStore` for one store per app/request root rather than process-global state.

## Public API index

Exported symbols detected in the package root `src/index.ts`. Platform-specific subpaths and structural contracts are explained in the detailed guide and package manifest.

- `CreateStoreOptions`
- `DeepReadonly`
- `ReadonlyStoreState`
- `Store`
- `StoreWriter`
- `createStore`
- `createStoreContext`
- `getOrCreateRootStore`
- `provideStore`
- `requireStore`
- `useStore`

## Detailed feature guide

### API — scoped MVVM

~~~ts
import { createOwner, disposeOwner, runWithOwner } from "@zaakiyjs/core";
import {
  createStore, createStoreContext, provideStore, requireStore
} from "@zaakiyjs/store";

interface CartViewModelPort {
  readonly state: { readonly quantity: { readonly value: number; peek(): number } };
  readonly actions: { readonly add: (count: number) => void };
}
const CartContext = createStoreContext<CartViewModelPort>("Cart");
const app = createOwner();
const cart = runWithOwner(app, () => createStore({
  state: { quantity: 0, customer: { label: "Guest" } },
  actions: ({ update }) => ({
    add(count: number) { update("quantity", previous => previous + count); }
  })
}));
provideStore(app, CartContext, cart);
const child = createOwner(app);
const vm = requireStore(child, CartContext);
vm.actions.add(2);
console.log(vm.state.quantity.value); // 2
disposeOwner(app);
~~~

For application-wide state use a fresh app/request owner and getOrCreateRootStore:

~~~ts
const root = createOwner(); // a different root for each SSR request
const CartToken = createStoreContext<ReturnType<typeof createCart>>("Cart");
function createCart(owner: import("@zaakiyjs/core").OwnerScope) {
  return createStore({
    owner,
    state: { quantity: 0 },
    actions: ({ update }) => ({
      add(amount: number) { update("quantity", old => old + amount); }
    })
  });
}
const cart = getOrCreateRootStore(root, CartToken, createCart);
~~~

Model/repository modules own business rules, stores own shared state, ViewModels consume focused typed store ports from Core context, and TSX Views read readonly signals and invoke actions. Local stores use component owners; route/feature stores use descendant owners. Do not import mutable singleton modules into ViewModels.

### API and semantics

- createStore({ state, actions, owner? }) creates one signal per top-level state field. The owner defaults to Core's current synchronous lexical owner. A live owner is always required.
- store.state.field.value and .peek() expose deeply frozen copies of plain data. Supported values are primitives, dense arrays and acyclic plain objects, including null-prototype records. Dates, Map/Set, functions, getters, symbol keys, sparse arrays and class instances are unsupported. The package never silently serializes values or invokes state accessors. Large objects are cloned on write; prefer normalized slices.
- actions: ({ get, set, update, patch }) => ({ ... }) runs once and returns named synchronous actions. The writer only permits mutations during a wrapped declared action. Actions run inside Signals.batch, including nested invocations. get and update receive readonly values; set and patch accept replacement values. Deep mutation is neither observed nor allowed; replace the field with a new value.
- store.select(state => ...) uses the existing lazy computed() engine, including memoization and dynamic dependency switching. The selector factory itself is not cached. Each invocation creates one derivation; retain shared selectors in the ViewModel. Parameterized selector caches and their eviction policies are deferred.
- store.reset() restores the original captured immutable values, updating individual fields in a single Signals.batch. It does not hold on to the caller's mutable original input.
- store.dispose() immediately rejects all later reads and actions. Owner disposal rejects writes immediately, but existing field/selector reads and Store context lookup remain available to Core's synchronous descendant cleanup callbacks until the store's own parent cleanup closes it; reads from unrelated owners are rejected. After owner teardown, reads and actions both fail. `store.disposed` reports final closure, not Core's in-progress teardown. A failing action propagates its exception and retains earlier writes; Signals.batch coalesces notifications, not rollback. Invalid patch values and keys are checked before applying patch fields.
- createStoreContext<T>(), provideStore(), useStore(), and requireStore() delegate hierarchical lookup and overrides to Core context. For actual Store instances, provideStore, useStore and requireStore reject cross-application ownership, stale disposed instances and scopes that outlive the store owner. Test-double ports without an owner are supported. Providers never use a mutable process-wide map.
- getOrCreateRootStore(owner, token, root => createStore({ owner: root, ... })) creates one instance per application/request root and context token, and rejects mismatched factory ownership. Independently mounted applications or server requests have isolated roots.

### Ownership and limitations

Attach effect handles to their own Core owner with onCleanup or ownEffect; child owners are disposed before parent store providers. This package does not dispose effects that consumers independently create. Signals currently does not expose computed.dispose(), so an *unowned* external effect can retain a computed subscription after store disposal; proper owner-scoped effects are required for leak-free teardown. The store does not implement another scheduler to work around that contract.

No automatic snapshots, serialization, hydration, persistence, logging or telemetry are provided. Never place application secrets in client state. No localStorage, global patching, eval or dynamic generated code.

## Integrate with neighboring packages

- [@zaakiyjs/signals](./signals.md)
- [@zaakiyjs/core](./core.md)
- [@zaakiyjs/forms](./forms.md)
- [@zaakiyjs/router](./router.md)

## Source and maintenance

- [Package README](https://github.com/sanukhandev/zaakiyjs/blob/9f6c6603c98ca566c2fed6fed34cc770f6a72960/packages/store/README.md)
- [Public source exports](https://github.com/sanukhandev/zaakiyjs/blob/9f6c6603c98ca566c2fed6fed34cc770f6a72960/packages/store/src/index.ts)
- [Package test cases](https://github.com/sanukhandev/zaakiyjs/tree/9f6c6603c98ca566c2fed6fed34cc770f6a72960/packages/store/test)
- Update this page when public APIs, runtime semantics or platform guarantees change.
