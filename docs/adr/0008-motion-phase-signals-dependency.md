# ADR 0008 — Motion phase signals use the existing Signals engine

- **Status:** Proposed for acceptance with P2-04; no change to TSX grammar, DOM ABI or compiler IR.
- **Date:** 2026-11-05
- **Owners:** `@zaakiyjs/motion` and the dependency policy in ADR 0007.
- **Context:** Contract 11 reserves `MotionHandle.phase: ReadonlySignal<MotionPhase>` and `PresenceController.phase: ReadonlySignal<PresencePhase>`. Core re-exports the type from Signals, but does not expose a `signal()` constructor. Building a new observable implementation in Motion would violate the one-reactivity-engine rule.

## Decision

Allow the optional browser package `@zaakiyjs/motion` to depend directly on **public** `@zaakiyjs/signals` for writable internal state and on `@zaakiyjs/core` for owner cleanup. Public phase surfaces expose only `ReadonlySignal` from Core; consumers cannot mutate through the typed interface. Never create a second scheduler or use ambient promises/context patches.

This is an explicit narrow amendment to ADR 0007's Motion dependency allowlist, which previously mentioned only Core and browser DOM as possible imports. It does not add a mandatory Motion dependency to UI, Router, Styles, Compiler, Core or Signals. Core's existing dependency on Signals follows the same direction, so there is no new package cycle.

## Safety and compatibility

- Motion imports must remain side-effect free in Node/SSR with no browser globals at module evaluation.
- All animation handles are owned or independently disposable, and owner disposal terminates outstanding WAAPI/RAF work.
- The new Signals dependency is an ordinary independent versioned workspace dependency included in frozen lockfiles and external npm pack-consumer verification.
- `@zaakiyjs/motion` stays optional; applications not importing it ship no Motion JS.
- The public contract's `phase` values and cancellation `MotionResult` are unchanged. There is no migration for unpublished consumers.

This ADR grants **no** authority to implement declarative `<Presence>`, intercept Router internals or defer compiler-owned DOM region disposal. Those remain issue #37 and separately reviewed adapter work.
