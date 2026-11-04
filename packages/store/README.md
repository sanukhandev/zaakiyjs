# @zaakiyjs/store

Owner-scoped fine-grained state built exclusively on @zaakiyjs/signals and @zaakiyjs/core. No virtual DOM, proxies, process-wide singleton registry, separate scheduler, subscriptions layer or implicit persistence.

## API — scoped MVVM

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

## API and semantics

- createStore({ state, actions, owner? }) creates one signal per top-level state field. The owner defaults to Core's current synchronous lexical owner. A live owner is always required.
- store.state.field.value and .peek() expose deeply frozen copies of plain data. Supported values are primitives, dense arrays and acyclic plain objects, including null-prototype records. Dates, Map/Set, functions, getters, symbol keys, sparse arrays and class instances are unsupported. The package never silently serializes values or invokes state accessors. Large objects are cloned on write; prefer normalized slices.
- actions: ({ get, set, update, patch }) => ({ ... }) runs once and returns named synchronous actions. The writer only permits mutations during a wrapped declared action. Actions run inside Signals.batch, including nested invocations. get and update receive readonly values; set and patch accept replacement values. Deep mutation is neither observed nor allowed; replace the field with a new value.
- store.select(state => ...) uses the existing lazy computed() engine, including memoization and dynamic dependency switching. The selector factory itself is not cached. Each invocation creates one derivation; retain shared selectors in the ViewModel. Parameterized selector caches and their eviction policies are deferred.
- store.reset() restores the original captured immutable values, updating individual fields in a single Signals.batch. It does not hold on to the caller's mutable original input.
- store.dispose() and owner disposal make later field reads and actions fail with a disposed error. A failing action propagates its exception and retains earlier writes; Signals.batch coalesces notifications, not rollback. Invalid patch values and keys are checked before applying patch fields.
- createStoreContext<T>(), provideStore(), useStore(), and requireStore() delegate hierarchical lookup and overrides to Core context. Providers never use a mutable process-wide map.
- getOrCreateRootStore(owner, token, root => createStore({ owner: root, ... })) creates one instance per application/request root and context token, and rejects mismatched factory ownership. Independently mounted applications or server requests have isolated roots.

## Ownership and limitations

Attach effect handles to their own Core owner with onCleanup or ownEffect; child owners are disposed before parent store providers. This package does not dispose effects that consumers independently create. Signals currently does not expose computed.dispose(), so an *unowned* external effect can retain a computed subscription after store disposal; proper owner-scoped effects are required for leak-free teardown. The store does not implement another scheduler to work around that contract.

No automatic snapshots, serialization, hydration, persistence, logging or telemetry are provided. Never place application secrets in client state. No localStorage, global patching, eval or dynamic generated code.

This P1 implementation remains on a draft PR until the integration owner updates the root seven-package M0 verifier, reconciles the frozen pnpm lockfile, and validates real package/root builds. It is not an npm publication.
