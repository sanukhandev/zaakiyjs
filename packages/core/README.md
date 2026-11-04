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

`createOwner()` has no implicit current-owner parent: explicitly pass a parent, or obtain a new isolated root. `runWithOwner` sets a **synchronous** lexical owner; owner context never propagates across `await`, timers or Promise callbacks. `onCleanup` and `onMount` require a lexical owner. `mountOwner` executes mount hooks once and makes the owner active; callback errors dispose it. Disposal visits children in reverse creation order and callbacks in reverse registration order, continues after failures, and throws an AggregateError for multiple failures. Disposal is idempotent; subsequent registrations are rejected.

`deactivateOwner`, `suspendOwner`, and `activateOwner` only label lifecycle state. **They do not pause effects, cancel requests or implement KeepAlive.** An explicit `transferOwner` moves a nonroot scope within its existing application tree. Cross-root transfers and ancestor cycles are rejected. Providers are scope-local and immutable per token, child scopes can override, and provider entries are cleared on disposal. `useContext` returns undefined if missing; `requireContext` throws `MissingProviderError`. Service disposal is explicit through cleanup registrations.

`executeComponent(component, props, owner)` initializes a component exactly once for a fresh owner; reactive bindings live in `@zaakiyjs/dom` and will update independently of this setup function. An exception during setup disposes the owner. Resources with a `dispose()` method can be attached with `ownDisposable`; this accepts `@zaakiyjs/signals`'s effect handle when signals is implemented.

## TSX and compiler ABI

Set `"jsx": "preserve"` and `"jsxImportSource": "@zaakiyjs/core"`. JSX types cover TypeScript's HTML/SVG tag maps, typed event callbacks, element refs, common attributes, data and ARIA attributes, and selected element-specific props. There is **no** `jsx/jsxs/jsxDEV` runtime: executable TSX requires the separate Zaakiy compiler/DOM integration. DOM/compiler agents should invoke `executeComponent` on a new child owner; call `mountOwner` only after insertion, and dispose the tree before detaching nodes.

## Dependencies and verification boundaries

Runtime dependency: `@zaakiyjs/signals` **type imports only** at the M0 baseline. No global DI registry, async context patch, or HTML evaluation. Integration with executable effects and compiler-generated DOM is deferred until the independently developed signals and DOM packages land. The M0 root export-surface test requires a coordinated integration update because it assumes every package exposes only its `implemented: false` status. This package intentionally sets that flag to true and supplies runtime functions; do not mask the mismatch.

First npm release is **not** authorized until namespace, license, package pack and compatibility reviews.
