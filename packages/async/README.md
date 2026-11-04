# @zaakiyjs/async

Native Promise/AbortSignal asynchronous resources and tasks using @zaakiyjs/signals and Core ownership. No Zone.js, Promise monkey-patching, browser transport or process-global caches.

## Resource: read-oriented async state

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

## Task: explicit work

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
- `queue` is FIFO serial, bounded by `maxQueue` (default 64 waiting, excluding the active operation). Overflow raises `BusyError("QUEUE_FULL")`; queued caller cancellation removes its entry.
- `reject` rejects overlap with `BusyError("BUSY")`.

Mutation retry requires **both** an explicit retry configuration and `idempotent: true`. This flag is only the caller's claim; actual side effects need server-side idempotency.

## Cancellation and errors

Native AbortController composes manual, owner, caller, superseded and timeout cancellations. `composeSignals(signals, timeoutMs?)` works without newer AbortSignal static helpers; dispose the returned handle to remove listeners/timers. Operation timeout includes retries and their backoffs, not just the loader. Retry is opt-in, bounded to 20 total attempts, exponential and abort-aware; default jitter is zero. A cancelled consumer rejects promptly even if an upstream Promise ignores its signal, and that Promise's eventual result cannot publish state. Cancellation cannot undo external/server side effects.

`CancellationError.kind` identifies `manual`, `owner`, `superseded`, `caller` or `timeout`. `TimeoutError` has code TIMEOUT; ordinary errors use RESOURCE_FAILED or TASK_FAILED with `cause`. Other codes: BUSY, QUEUE_FULL, INVALID_CONFIG and DISPOSED. Unexpected loader errors are not silently converted into cancellation.

## Cache isolation and lifecycle

No default global cache exists. `createResourceCache()` creates a new bounded LRU per Core owner root, with hard cacheTimeMs (default five minutes), configurable staleTimeMs and bounded in-flight producers. Cached resources **must** supply a stable typed `cacheKey`; include tenant/user authorization identity when identities may change within a single root. An owner-scoped cache rejects access from other application/SSR roots. A standalone cache requires an explicit private identity:
```ts
const scope = {};
const cache = createResourceCache({ owner: null, scope });
const resource = createResource({ load: async () => 1, cache, cacheScope: scope, cacheKey: () => "one" });
```
In-flight deduplication is enabled by default when a cache is supplied. Each consumer owns a lease; cancelling one does not abort a shared producer while other consumers remain. The last consumer release aborts it. Explicit cache invalidation also aborts matching in-flight producers.

Resources, tasks and caches capture their synchronous owner and register cleanup at creation. Pass `owner` explicitly when creating outside `runWithOwner`; ownership never propagates implicitly through await. Core's deactivated/suspended KeepAlive states are **not** disposal and do not automatically pause work. HTTP, Router, Forms and Store integrate through repository abstractions and AbortSignal parameters—no imports or cycles.

Run package lint/typecheck/build/Vitest tests plus pack/ESM smoke tests before publication. A new npm package requires scope-ownership verification and independent release approval. Network cancellation protects UI state, not physical rollback of server mutations.
