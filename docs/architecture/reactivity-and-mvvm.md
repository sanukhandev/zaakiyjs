# Signals, Ownership, Lifecycle, SOLID and MVVM

## One reactivity implementation

Primitives: `signal(initial)`, lazy `computed(fn)`, `effect(fn)`, `batch(fn)`, `untrack(fn)`, `onCleanup(fn)` and controlled `flushSync`. Typed HTML/SVG props and signal-backed expressions are first-class. Effects track their current dynamic dependency reads, invalidate precisely, deduplicate in batches and guard cycles.

Scheduler: mark dirty synchronously; default to queued batched DOM writes, recompute computed dependencies before effects, preserve event order, document flush phases. Pure computed values are memoized by dependency invalidation, not by component rerender heuristics.

## Ownership tree and lifecycle

```text
Application (root-scoped global providers)
  -> Route/Page (loader, adapter, cache and navigation lifetime)
     -> Feature (forms and shared feature ViewModels)
        -> Component (signals, effects, DOM listeners)
```

A root singleton is per mounted application. On the server, never share user-specific state across requests; use a fresh request owner and request-scoped providers.

Lifecycle states: created -> initialized -> mounted -> active; optionally deactivated (retained), suspended (async pending) or reactivated; permanently disposed. **Deactivated**, **suspended**, **disposed** mean different things. KeepAlive has bounded eviction and explicit policies for ongoing async operations. Dispose descendant resources before parent providers. Stale async completions must not write to disposed owners.

## SOLID boundaries

- **S:** Views render, ViewModels orchestrate presentation state, Models define rules, infrastructure executes I/O.
- **O:** extend through composition, stable contracts and explicit adapters.
- **L:** service implementations honor the same functional/error/authorization contract.
- **I:** focused type-safe interfaces instead of god-services.
- **D:** ViewModels depend on repository abstractions, not concrete Fetch or database clients.

Use function factories and interfaces where appropriate; no needless class inheritance or one-class-per-file rule.

## MVVM template (conceptual)

```tsx
interface ProductRepository {
  get(id: string, signal: AbortSignal): Promise<Product>;
}

function createProductViewModel(repo: ProductRepository, id: string) {
  const product = createResource({
    key: () => ["product", id],
    load: ({ signal }) => repo.get(id, signal)
  });
  return { product, reload: () => product.refresh() };
}

function ProductView(props: { vm: ProductVM }) {
  return <h1>{props.vm.product.data.value?.name}</h1>;
}
```

These public functions/types are **proposals**, not implemented APIs.

## State ownership

Local component state is top-down/unidirectional; child events invoke parent actions. Global store has explicit write actions and read-only consumer selectors. Provider lookup follows lexical scope visibility; do not use a mutable process-global service locator.

Custom signals compose existing primitives; the CLI must not generate alternate reactive engines. Form fields own field-level state and async validation; page adapters bind repository/provider/ViewModel/page metadata.

## Diagnostics and verification

Build toward a **Verified Runtime** that reports leaked owner resources, stale requests, invalid provider lifetimes, render causality and improper cross-scope access. Static analysis detects obvious violations; external library resource leakage needs runtime instrumentation, tests or explicit contracts. A tracing inspector should explain signal -> resource -> interceptor -> DOM paths without shipping instrumentation by default.
