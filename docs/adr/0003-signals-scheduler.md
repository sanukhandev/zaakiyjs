# ADR 0003 — Signals scheduler and effect execution semantics

- **Status:** Accepted for the M1 Signals ABI; browser/runtime integration still requires verification.
- **Date:** 2026-11-04
- **Owners:** `@zaakiyjs/signals` implements; `@zaakiyjs/core` attaches returned effect handles to owner teardown; `@zaakiyjs/dom` uses render-phase effects.
- **Supersedes:** the scheduler timing and error-handling questions in `docs/contracts/08-open-decisions.md`.

## Decision

1. `effect(callback)` **executes synchronously once on registration**. If the callback fails without a handling `onError`, registration throws and disposes partial subscriptions. Initial execution is not postponed to a microtask.
2. A changed `signal.value` marks subscribers and dependent computeds dirty synchronously, but **subsequent effect executions are queued in a microtask**. Pending work is deduplicated by effect identity within each phase. A nested `batch` delays automatic draining until the outermost batch returns; batching never loses invalidations.
3. Flush precedence is **all currently queued `render` effects before `user` effects**, with insertion order within a phase. If a user effect schedules render work, render gets priority on the next drain iteration. Native event handlers are not intercepted.
4. A `computed` is lazy, memoized, dynamically tracks reads, may change dependencies on each successful evaluation, and throws on circular read. Re-evaluation of a computed must not directly write to signals. Computeds settle before a downstream effect reads them. A subscribed effect whose complete dependency set comprises computeds that all remain `Object.is`-equal may skip its rerun.
5. `untrack(fn)` suppresses reactive dependency acquisition for its synchronous dynamic extent and restores the previous tracker even on error. Effect cleanup and `onError` execute untracked, including cleanup run during an already tracked parent. Async effects are not awaited and must not implicitly propagate tracking state through native Promises or timers.
6. `flushSync(fn?)` first runs the optional callback and then synchronously drains pending effects (render before user). It **rejects invocation from a tracked computation** and **from an active scheduler drain** to avoid recursive scheduling. If both the callback and flush throw, it reports both via `AggregateError`.
7. Each effect may execute up to **1,000 times per flush**. A cyclic effect exceeding this limit is quarantined for the remainder of that flush; unrelated queued work continues. A global emergency limit of **1,000,000 executions** aborts the remaining queue. Unhandled effect errors aggregate after independent jobs finish; a user-supplied `onError` callback handles the failed effect's error, but a throwing error handler is itself reported.
8. `effect` returns an explicitly disposable handle. It detaches all dependencies, drops pending work, runs final cleanup once and is safe to dispose repeatedly. `signals` has **no dependency on core**, DOM, Zone.js, or async browser patching; `core` owns the registration of handles within OwnerScope.

## Compatibility consequences

These decisions define the v1 public behavioral contract for Signals and are not optional scheduling optimizations. Runtime/DOM bindings must use `phase: "render"` rather than introducing a second scheduler. Input/focus preservation and DOM ownership are outside this ADR, but require cross-package fixtures before runtime publication.

An independent `@zaakiyjs/signals` build and behavioral test run does **not** prove full framework compatibility. Before merging the next dependent package, test latest Signals with latest Core/DOM and verify effect cleanup across disposal and conditional/keyed node removal.

## Alternatives rejected

- Deferred initial effect invocation: introduces setup timing ambiguity for component binding initialization.
- Synchronous reruns on every write: creates redundant DOM mutation storms and can break owner setup.
- A second core/DOM scheduler: introduces inconsistent phases and edge-case races.
- Global Promise/timer monkey-patches: violates zoneless/deterministic runtime constraints.

## Future revisions

Cross-root fairness, starvation thresholds, per-owner error channels, and async resource orchestration remain separate design questions. Changing phase order or initial effect timing requires a new ADR and joint runtime/DOM contract tests.
