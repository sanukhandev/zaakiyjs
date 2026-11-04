# Contract 02 — owner tree, providers and component setup (v1)

**Owner:** `@zaakiyjs/core`. Planned operations (not runtime exports in M0):

```ts
createOwner(parent?: OwnerScope | null): OwnerScope
runWithOwner<T>(owner: OwnerScope, initialize: () => T): T
getOwner(): OwnerScope | null
onCleanup(dispose: () => void): void
disposeOwner(owner: OwnerScope): void
createContext<T>(description?: string): ContextToken<T>
provide<T>(owner: OwnerScope, key: ContextToken<T>, value: T): void
useContext<T>(owner: OwnerScope, key: ContextToken<T>): T | undefined
```

`createOwner` creates an independent child when a parent is supplied, or a root otherwise. `runWithOwner` sets a synchronous lexical initialization context and restores the previous owner even if the callback throws; no global Promise/timer patches. Provider lookup traverses self then ancestors; nearest provider shadows inherited values. Missing provider returns `undefined`, never an arbitrary process-level singleton. A mounted application defines its own root; an SSR request must receive a fresh root.

**Disposal:** children dispose before a parent; each cleanup callback runs once, in reverse registration order within its owner. Disposed owners reject new effects, bindings and providers. Owned event listeners/subscriptions/async resources close on disposal. `deactivated`, `suspended`, and permanently `disposed` are distinct; KeepAlive policies are deferred and cannot be inferred from a boolean. Track lifetime independently of DOM presence.

**Component contract:** a TSX component is a typed synchronous function initialized **once per owner instance**, not a rerender callback. Its returned view description is compiler-lowered to DOM creation and targeted bindings. Props/events are typed; ownership belongs to the call site. Signal values appearing inside tracked expressions update bindings without reinitializing component state. On unmount, dispose component/descendant owners then detach DOM. Do not make stateful singleton components shared across application roots.

`core` may re-export owner-aware forms of `signal`/`effect`, but it imports `signals`; `signals` never imports `core`. For M0 only types exist.
