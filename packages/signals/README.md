# @zaakiyjs/signals

A small, framework-independent TypeScript reactive graph. No DOM, ownership, async-context patching, framework runtime, or AI dependency.

## API

~~~ts
import { signal, computed, effect, batch, flushSync, untrack } from "@zaakiyjs/signals";

const count = signal(0);
const doubled = computed(() => count.value * 2);
const binding = effect(() => console.log(doubled.value), { phase: "render" });

batch(() => { count.value++; count.value++; });
flushSync(); // forces the queued render binding to run
const snapshot = untrack(() => count.value); // or count.peek()
binding.dispose();
~~~

- signal<T>(initial, { equals? }): mutable .value, .peek(), and Object.is equality by default. Custom equals is contract-approved and must be pure.
- computed<T>(calculate): lazy, readonly .value and .peek(), memoized with dynamic dependency tracking. Calculators must be synchronous and may not modify signals.
- effect(run, { phase?: "render" | "user", onError? }): **immediately** invokes run once, tracks reads, then queues deduplicated reruns. Return a cleanup function to execute immediately before a later rerun or on disposal. The disposable handle is for owner integration; signals does not import core.
- batch(run): only the outermost batch schedules automatic flushing. Nested batches and exception unwind are safe.
- untrack(read): suppresses dependency registration for this synchronous callback (computed bodies still track their own reads).
- flushSync(run?): optionally run a callback, then synchronously drain scheduled effects, even within batch. Calling it from a tracked computation or during an active scheduler drain throws; nested calls outside a running drain are allowed.

## Scheduling, errors, lifecycle

Writes synchronously invalidate computed nodes and schedule effects for a queueMicrotask drain. Dirty computed nodes settle on demand before a consuming effect sees a value. During each drain, render jobs have priority over user jobs, and insertion order within a phase is stable. New jobs are drained until the queues empty; a 1,000-run-per-effect cycle limit permits large fanout, while a 1,000,000-execution limit protects against runaway work. When an individual effect exceeds 1,000 executions during a flush, it is quarantined for that flush and the scheduler continues unrelated queued effects before reporting the cycle diagnostic. The emergency 1,000,000-execution ceiling aborts the entire flush. No timers, Promises, Zone.js, or global APIs are patched.

Errors from an effect are passed to its onError callback, when provided; otherwise they are thrown from flushSync or the scheduled microtask. The scheduler continues processing independent queued effects and restores its state. Failed effect/computed evaluations retain the last successful dependency set and reads reached before failure, enabling error-handler recovery on future changes. Successful reruns prune obsolete subscriptions. A failed initial effect with no error handler is disposed and throws. Self-disposal cannot reattach dependencies, and returned cleanup after self-disposal executes immediately. Asynchronous callbacks are not awaited, tracked or cleaned up by this synchronous engine; use explicit cancellation through a separate owner/resource layer.

Computed values without observers use dependency revisions to maintain cached reads without leaving inbound subscriptions. When later observed, these computed nodes reconnect upstream subscriptions on demand, including after previously being evaluated while cold. Once the final effect observing a derived chain is disposed, upstream subscriptions detach; later reads revalidate lazily. Disposers are idempotent, and effect cleanup executes once. Cleanup functions and onError handlers run without inherited dependency tracking so disposing nested effects cannot register accidental subscriptions. Avoid retaining effect handles after their owner is released.

Computed-only effects are skipped if every computed dependency settles to the same value (using `Object.is`), avoiding unrelated DOM mutations. Effects that also track a direct signal retain normal invalidation behavior. Failed computed reads are still delivered to the effect and its error handler.

## Benchmark

Run pnpm --filter @zaakiyjs/signals build followed by pnpm --filter @zaakiyjs/signals benchmark. The synthetic benchmark uses 1,000 subscribers and 5,000 batches and reports Node version, elapsed time, and executions; it is not evidence of superiority over any other framework.

## Integration and release decisions

The M0 root export-surface test was updated on `main` to recognize implemented packages. Scheduler details remain **provisional pending an accepted ADR**: initial synchronous effect execution; error aggregation and reporting policy; nested/active `flushSync` behavior; cycle thresholds and offender quarantine. Preserve the draft PR until those cross-package integration contracts are approved.

No npm publication is authorized without package verification, license, and namespace ownership review.
