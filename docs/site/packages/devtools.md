---
title: "@zaakiyjs/devtools (planned)"
description: "Proposed signal, DOM, ownership and network diagnostics"
sidebar_position: 25
---

# @zaakiyjs/devtools — proposed debugging tools

> **Status: Planning only.** No `packages/devtools` directory or frozen public import contract exists on the documented main revision. The capabilities below are **requirements and design questions**, not live features.

## Intended audience

Framework application developers need to understand why a signal changed, which binding was invalidated, whether a route owner disposed its resources and why an async task was cancelled—without introducing a virtual DOM, process-global telemetry or exposing credentials.

## Proposed debugging surfaces

| Category | Diagnostic questions |
| --- | --- |
| Signals and scheduler | Which signal triggered an effect? Was it batched? Which computed dependency changed? |
| Owner scopes | Where was a component created? Are effects/listeners cleaned up after route disposal? |
| DOM mutations | Did an update touch only expected nodes? Did keyed identity and focus remain stable? |
| Router and Async | Was a navigation superseded? Did an aborted resource publish stale results? |
| HTTP | How long did a request take? Was it cancelled or retried? Which sanitized error code? |
| Compiler and CSS | Which original TSX span maps to a binding? Which utility generated a CSS rule? |

## Design principles to freeze before code

- Browser inspection is **opt-in** and development-only; production builds must not ship unnecessary listeners, trace buffers or secret-bearing state.
- Devtools must observe the existing Signals/Core/DOM ABI and not create a competing scheduler or renderer.
- Instrumentation must avoid changing effect execution order, DOM identity or the user's own observable application state.
- Trace memory must be bounded and disposable. Recording must not leak state across application roots or SSR requests.
- Network logs must redact tokens, cookies, bodies and personal identifiers.
- Source map and compiled binding correlation must be based on versioned, stable IDs.

## Suggested implementation milestones

1. ADR for stable instrumentation hooks and correlation IDs.
2. Minimal owner/signal timeline with bounded in-memory ring buffer.
3. DOM targeted-mutation viewer and compiler source-location cross-reference.
4. Router/Async cancellation trace correlation.
5. Browser panel and developer experience after performance/security audits.
6. Production opt-out and zero-leak acceptance tests.

No API names, CLI commands or browser extension behavior should be promised until these contracts exist and their overhead is measured.

## Acceptance criteria

Correct signal/owner traces without changing scheduling, zero retained listeners after disposal, safe error redaction, cross-root isolation, measured opt-in overhead and deterministic browser behavior in Chromium/Firefox/WebKit.

## References

- [Framework architecture](../../architecture/overview.md)
- [Signals](./signals.md)
- [Core](./core.md)
- [DOM](./dom.md)
- [Router](./router.md)
- [Testing guidance](../../development/testing-and-quality.md)
