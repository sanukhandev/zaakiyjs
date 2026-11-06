---
title: "@zaakiyjs/testing (planned)"
description: "Testing package design, existing quality workflow and future fixture APIs"
sidebar_position: 26
---

# @zaakiyjs/testing — proposed package

> **Status: Proposed standalone package, not implemented on the documented main revision.** Existing repository Vitest/Playwright test suites and scripts are real. A public `@zaakiyjs/testing` package API, fixtures and exports are **not** claimed.

## What you can use now

Tests already live under each package and shared repository test directories. The root scripts are:

```sh
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm build
pnpm test
pnpm ci
```

`pnpm ci` runs lint, typecheck and tests with their configured prerequisite builds. Additional browser/security workflows are not automatically implied by this script; inspect the required GitHub Actions workflows and current commit status.

## Testing layers for ZaakiyJS

| Layer | Example assertion |
| --- | --- |
| Signals (Vitest) | Effects track changing dependencies, batch correctly, dispose exactly once |
| Core ownership | Child-first cleanup, context inheritance, duplicate disposal safety |
| Compiler golden | TSX to IR/schema and emitted JS are deterministic with correct source maps |
| DOM integration | Only the target Text.data/property/attribute mutates when a signal changes |
| Keyed rendering | Reordering retains native node identity, focus and event listeners |
| Async & network | Aborts, stale result suppression, timeouts, retry/idempotency correctness |
| Security | Unsafe URL/HTML sinks, CSP, credential leakage, proxy SSRF isolation |
| Accessibility | Semantic controls, keyboard focus, error announcement and reduced motion |
| Browser matrix | Real Chromium/Firefox/WebKit behavior using production-built fixtures |
| Release artifacts | npm pack, clean consumer install, ESM exports, declarations and license |

## Proposed helper package design

A future testing package could expose owner-aware fixture setup, deterministic signal flush helpers, native DOM mutation assertions and compiler fixture orchestration. None of those helper names or signatures is frozen today. Avoid designing private test-only renderers that mask a bug in the real compiler/DOM integration.

High-value helper requirements: explicit ownership/disposal, compatibility with existing Vitest/Playwright, no framework runtime dependency, no modification of global timers/Promises by default, deterministic fixtures and accurate diagnostics.

## Release and quality targets

The framework's documented targets include ≤12 KiB gzip for minimal runtime, zero unrelated DOM mutations, zero retained owned listeners after disposal, browser target certification and reproducible pinned build hashes. These are **engineering targets**, not automatically proven measurements. Published consumers need an independently verified npm artifact, not only workspace tests.

## Developer workflow

1. Write a failing behavioral fixture for the contract being changed.
2. Implement and run local unit/component tests.
3. Validate real compiled TSX and generated DOM rather than substitute runtimes.
4. Test browser/assistive technology/security boundaries relevant to the feature.
5. Document package changes, sizes and impact with exact executed command evidence.
6. Check independent publishing and changeset gates separately.

## References

- [Testing and quality policy](../../development/testing-and-quality.md)
- [Repository architecture](../../architecture/overview.md)
- [DOM](./dom.md)
- [Compiler](./compiler.md)
- [Signals](./signals.md)
