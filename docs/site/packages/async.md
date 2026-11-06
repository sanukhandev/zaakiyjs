---
title: "@zaakiyjs/async"
description: "Abort-aware resources, explicit tasks, concurrency policies, retries and isolated caches"
sidebar_position: 11
---

# @zaakiyjs/async

Use Async for ViewModel resources and mutation tasks; it has no transport implementation and does not patch Promises.

> **Availability:** Source implementation in ZaakiyJS, not a verified published npm release. The package's manifest at the referenced revision uses `0.0.0`; use workspace tooling until independent publishing is approved.

## At a glance

- **Use it when:** Use `createResource()` for read-oriented reactive fetching and `createTask()` for explicitly invoked work.
- **Reference revision:** [9f6c6603c98c](https://github.com/sanukhandev/zaakiyjs/commit/9f6c6603c98ca566c2fed6fed34cc770f6a72960).

## Try it in the monorepo

```sh
pnpm --filter @zaakiyjs/async typecheck
pnpm --filter @zaakiyjs/async test
pnpm --filter @zaakiyjs/async build
```

## Feature usage: first working pattern

```ts
import { createOwner, runWithOwner, disposeOwner } from '@zaakiyjs/core';
import { signal } from '@zaakiyjs/signals';
import { createResource } from '@zaakiyjs/async';

const owner = createOwner();
const id = signal('p1');
const item = runWithOwner(owner, () => createResource({
  key: () => id.value,
  load: async ({ key, signal }) => {
    const response = await fetch(`/api/items/${encodeURIComponent(key)}`, { signal });
    if (!response.ok) throw new Error('Read failed');
    return response.json();
  },
  eager: true
}));
await item.refresh();
id.value = 'p2';
disposeOwner(owner);
```

## Usage and correctness guidelines

- Resource cancellation protects published UI state, not already completed server-side writes.
- `latest`, `parallel`, `queue`, and `reject` are task concurrency options; mutation retries require idempotent design.
- Create an explicit root- or request-scoped cache; avoid sharing tenant data through a process-global cache.

## Public API index

Exported symbols detected in the package root `src/index.ts`. Platform-specific subpaths and structural contracts are explained in the detailed guide and package manifest.

- `AsyncErrorCode`
- `AsyncOperationError`
- `BusyError`
- `CacheHit`
- `CacheOptions`
- `Cancellation`
- `CancellationError`
- `CancellationKind`
- `ConfigurationError`
- `DisposedError`
- `LoadContext`
- `Resource`
- `ResourceCache`
- `ResourceOptions`
- `ResourceStatus`
- `RetryOptions`
- `Task`
- `TaskContext`
- `TaskOptions`
- `TaskPolicy`
- `TaskRunOptions`
- `TaskStatus`
- `TimeoutError`
- `composeSignals`
- `createResource`
- `createResourceCache`
- `createTask`
- `isCancellation`

## Detailed feature guide

### Resource: read-oriented async state

```ts
import { createOwner, runWithOwner, disposeOwner } from "@zaakiyjs/core";
import { signal } from "@zaakiyjs/signals";
import { createResource, createResourceCache } from "@zaakiyjs/async";

interface Product { name: string }
interface Repository { get(id: string, signal: AbortSignal): Promise<Product> }
declare const repo: Repository;
const app = createOwner(); // fresh root per app or SSR request
const id = signal("p1");
const product = runWithOwner(app, () => {
  const cache = createResourceCache({ maxEntries: 100, cacheTimeMs: 60_000 });
  return createResource({
    key: () => id.value,
    load: ({ key, signal }) => repo.get(key, signal),
    eager: true,
    keepPreviousData: true,
    cache, cacheKey: key => "product:" + key,
    staleTimeMs: 10_000,
    timeoutMs: 8_000,
    retry: { maxAttempts: 2, baseDelayMs: 250 }
  });
});
await product.refresh(); // manual refresh bypasses completed cache
disposeOwner(app); // outstanding work is aborted and late results are ignored
```

`createResource({ load })` is lazy unless `eager: true`. After first execution, changing a reactive key triggers reload. Undefined/null keys and `enabled: false` disable execution. Default key equality is Object.is; use `equalsKey` for newly allocated tuple/object keys. `data`, `lastSuccessful`, `pending`, `refreshing`, `error`, `status` and `stale` are readonly signals. States: idle, pending, refreshing, success, error, cancelled. `refresh()` returns a native Promise; `cancel()` cancels only this consumer, `invalidate()` drops cache and revalidates eager resources, `dispose()` is permanent. Automatic eager rejections are observed internally; manual rejections belong to the caller.

### Task: explicit work

```ts
import { createTask } from "@zaakiyjs/async";
const save = createTask<{ id: string; value: string }, void>({
  execute: ({ input, signal }) => repo.save(input, signal),
  concurrency: "reject",
  timeoutMs: 10_000
});
await save.run({ id: "p1", value: "changed" });
```

Tasks execute **only** on `run(input, { signal? })`. Signals: `result`, `lastSuccessful`, `pending`, `pendingCount` (active operations), `queuedCount`, `status` and `error`. Shared result/status/error represent the **latest invoked** operation; older parallel completions cannot overwrite them. Each caller's Promise retains its own result or error.

Concurrency:
- `latest` (default) aborts earlier work and drops stale results.
- `parallel` runs simultaneously, with aggregate active counts.
- `queue` is FIFO serial, bounded by `maxQueue` (default 64 waiting, excluding the active operation). Overflow raises `BusyError("QUEUE_FULL")`; both shared and per-invocation caller cancellation remove queued entries before execution.
- `reject` rejects overlap with `BusyError("BUSY")`.

Mutation retry requires **both** an explicit retry configuration and `idempotent: true`. This flag is only the caller's claim; actual side effects need server-side idempotency.

### Cancellation and errors

Native AbortController composes manual, owner, caller, superseded and timeout cancellations. `composeSignals(signals, timeoutMs?)` works without newer AbortSignal static helpers; dispose the returned handle to remove listeners/timers. Operation timeout includes retries and their backoffs, not just the loader. Retry is opt-in, bounded to 20 total attempts, exponential and abort-aware; default jitter is zero. A cancelled consumer rejects promptly even if an upstream Promise ignores its signal, and that Promise's eventual result cannot publish state. Cancellation cannot undo external/server side effects.

`CancellationError.kind` identifies `manual`, `owner`, `superseded`, `caller` or `timeout`. `TimeoutError` has code TIMEOUT; ordinary errors use RESOURCE_FAILED or TASK_FAILED with `cause`. Other codes: BUSY, QUEUE_FULL, INVALID_CONFIG and DISPOSED. Unexpected loader errors are not silently converted into cancellation.

### Cache isolation and lifecycle

No default global cache exists. `createResourceCache()` creates a new bounded LRU per Core owner root, with hard cacheTimeMs (default five minutes), configurable staleTimeMs and bounded in-flight producers. Cached resources **must** supply a stable typed `cacheKey`; include tenant/user authorization identity when identities may change within a single root. An owner-scoped cache rejects access from other application/SSR roots. The cache's lifetime is tied to the **root** even if its factory ran inside a short-lived child: disposing that child must not cancel sibling cache users. A standalone cache requires an explicit private identity:
```ts
const scope = {};
const cache = createResourceCache({ owner: null, scope });
const resource = createResource({ load: async () => 1, cache, cacheScope: scope, cacheKey: () => "one" });
```
In-flight deduplication is enabled by default when a cache is supplied. Each consumer owns a lease; cancelling one does not abort a shared producer while other consumers remain. The last consumer release aborts it. Explicit cache invalidation also aborts matching in-flight producers.

Resources and tasks capture their synchronous owner and register cleanup via disposable Core child owners, avoiding unbounded cleanup registrations in long-lived scopes. Caches register cleanup against their application/request **root**. Pass `owner` explicitly when creating outside `runWithOwner`; ownership never propagates implicitly through await. Core's deactivated/suspended KeepAlive states are **not** disposal and do not automatically pause work. HTTP, Router, Forms and Store integrate through repository abstractions and AbortSignal parameters—no imports or cycles.

Run package lint/typecheck/build/Vitest tests plus pack/ESM smoke tests before publication. The pack smoke reports emitted ESM bytes, combined gzip bytes and npm archive bytes; these are not equivalent to a tree-shaken consumer bundle. A new npm package requires scope-ownership verification and independent release approval. Network cancellation protects UI state, not physical rollback of server mutations.

## Integrate with neighboring packages

- [@zaakiyjs/core](./core.md)
- [@zaakiyjs/signals](./signals.md)
- [@zaakiyjs/http](./http.md)
- [@zaakiyjs/router](./router.md)

## Source and maintenance

- [Package README](https://github.com/sanukhandev/zaakiyjs/blob/9f6c6603c98ca566c2fed6fed34cc770f6a72960/packages/async/README.md)
- [Public source exports](https://github.com/sanukhandev/zaakiyjs/blob/9f6c6603c98ca566c2fed6fed34cc770f6a72960/packages/async/src/index.ts)
- [Package test cases](https://github.com/sanukhandev/zaakiyjs/tree/9f6c6603c98ca566c2fed6fed34cc770f6a72960/packages/async/test)
- Update this page when public APIs, runtime semantics or platform guarantees change.
