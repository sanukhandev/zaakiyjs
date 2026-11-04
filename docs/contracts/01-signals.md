# Contract 01 — signals and deterministic scheduling (v1)

**Owner:** `@zaakiyjs/signals`. Reserved callable API (not yet exported/implemented):

```ts
signal<T>(initial: T, options?: { equals?: (a: T, b: T) => boolean }): WritableSignal<T>
computed<T>(read: () => T): ComputedSignal<T>
effect(run: () => void | (() => void), options?: EffectOptions): EffectHandle
batch<T>(run: () => T): T
untrack<T>(read: () => T): T
flushSync<T>(run?: () => T): T | void
```

`ReadonlySignal<T>` exposes readonly `.value` and `.peek()`; `WritableSignal<T>` exposes a mutable `.value`. A `computed` is readonly. `.peek()` and `untrack` never register dependencies. Equality uses `Object.is` by default; optional equality must be pure and may not suppress changes incorrectly. Do not overload `.value` with Promise semantics.

**Reactive semantics:** reading `.value` in a tracked computation registers that dependency. Dependency lists are replaced after each successful rerun so conditional reads can detach stale subscriptions. Writes mark dependents dirty *synchronously*; ordinary effects/DOM writes flush in a deduplicated queued batch. Computeds are lazy, cache until invalidated and must settle before dependent effects observe their values. Nested `batch` flushes once at the outer boundary. `flushSync` is an explicit escape hatch; never implicitly patch timers, Promise, Fetch or Zone.js.

**Flush phase order:** settle dirty computed values on demand; perform owned `render` bindings before `user` effects; preserve subscription registration order within a phase, deduplicate jobs per flush, and drain new work with a finite reentrancy/cycle guard. Event listeners run synchronously in native dispatch order. A self-triggering reactive cycle fails with a diagnostic instead of looping indefinitely.

**Ownership integration:** standalone `signals.effect` returns an explicit disposable handle. `@zaakiyjs/core` connects effect cleanup to an active OwnerScope **without** making signals depend on core. On each rerun, execute previous effect cleanup before the new body; on final disposal, run it exactly once. Throwing effects cannot leave stale tracking state. Async effects are not awaited by the synchronous reactive engine.

**To resolve before M1 release:** precise microtask vs synchronous first-effect invocation, error aggregation and `flushSync` reentrancy policy in [open decisions](08-open-decisions.md). These semantics are a design baseline, not passing tests.
