# @zaakiyjs/core

Component setup, deterministic owner trees, hierarchical contexts, and compiler-facing TypeScript/TSX types. No React, Vue, Angular, DOM implementation or runtime JSX factory is required.

## Owners and lifecycle

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

## Typed MVVM provider override

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

## TSX and compiler ABI

Set `"jsx": "preserve"` and `"jsxImportSource": "@zaakiyjs/core"`. JSX types cover TypeScript's HTML/SVG tag maps, typed event callbacks, nullable-on-unmount element refs, common attributes, data and ARIA attributes, and selected element-specific props. There is **no** `jsx/jsxs/jsxDEV` runtime: executable TSX requires the separate Zaakiy compiler/DOM integration. DOM/compiler agents should invoke `executeComponent` on a new child owner; call `mountOwner` only after insertion, and dispose the tree before detaching nodes.

## Dependencies and verification boundaries

Package dependency: `@zaakiyjs/signals` (currently type-only imports from Core). No global DI registry, async context patch, or HTML evaluation. The Core package has also been validated with real Signals and DOM implementations in an isolated integration branch (four dedicated cross-package tests); those independently developed package PRs must still be integrated through normal review. The shared M0 root export assertion was updated separately to accept genuinely implemented packages. Compiler-generated TSX integration and browser compatibility remain the responsibility of their respective packages.

First npm release is **not** authorized until namespace, license, package pack and compatibility reviews.

## Typed compiler-only control flow (M1)

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

These exported functions are **compile-time intrinsics**, not runtime JSX components; direct invocation intentionally throws. The compiler lowers to DOM ABI v1 `ConditionalBlock`/`KeyedLoop`, preserving per-item owner and signal identity. A single native child/root is required for the restricted M1 authoring slice. `by` accepts an inline arrow or named function reference returning a primitive key. Use a wrapping native element around nested regions. See [ADR 0005](../../docs/adr/0005-tsx-control-flow-intrinsics.md) for diagnostics, unsupported syntax and browser gates.

## Compile-time named slot marker

`Slot` is a compile-only Core intrinsic under opted-in IR v2. `<Slot name="header" />` mounts a caller-owned native factory into a native parent. A caller supplies `header={<h2>Title</h2>}` and the prop is typed as `JSXChild`. Slot names are static and allowlisted; arbitrary JSX expressions in unrelated props are still forbidden. Uncompiled calls to `Slot` throw (ADR 0013).
