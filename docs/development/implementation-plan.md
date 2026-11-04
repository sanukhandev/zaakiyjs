# Delivery Milestones and First Vertical Slice

> These milestones are **proposed**, not work already completed.

## M0 — Contracts and tooling bootstrap

Write ADRs for TSX authoring semantics, signal scheduling, component setup, owner scopes, IR versions, package exports, browser targets and AI trust. Create pnpm/Turborepo config, CI, lint/typecheck, minimal test harness and pinned dependencies. Freeze interfaces before parallelizing packages.

**Gate:** a typed TSX example goes through a build/compile pipeline with explicit runtime and compiler contracts.

## M1 — Reactive DOM foundation

Implement `signals`, scheduler, ownership, `dom` operations, TSX compiler, targeted bindings, conditional/keyed loops and deterministic cleanup. Counter, Todo and keyed-focus fixtures.

**Gate:** no whole-component rerender for isolated signal updates; browser and disposal tests pass and builds are reproducible.

## M2 — Branding, CSS, Vite and starter

Utility extraction, brand tokens, recipes, CSS output, Vite plugin with HMR and source maps, CLI `start --project`, source diagnostics and fixture install.

**Gate:** developer creates and builds a styled application with AI disabled.

## M3 — Application architecture

Implement MVVM stores/providers, form controllers, page adapters, routing, HTTP, interceptors, async resources/tasks and AbortSignal lifetime policies.

**Gate:** a realistic typed CRUD flow handles navigation cancellation, validation, and scoped global/local state.

## M4 — UI and server-capable rendering

Accessible primitives, branded UI, motion, browser compatibility, SSG/SSR/hydration, dynamic SEO, proxy/BFF and cache invalidation, progressively and behind stable contracts.

**Gate:** test indexable dynamic public pages and secure private application routes in supported browsers; validate server-request isolation.

## M5 — Verified runtime and AI

Causal signal/network/DOM inspector, scope lifecycle diagnostics, architecture checks, performance budgets and optional Gemini reviewed proposals.

**Gate:** model outage has no effect on ordinary builds, and accepted proposals have reproducible test/benchmark evidence.

## M6 — Ecosystem and release hardening

Mature docs, devtools, templates, analytics/ads/consent, migration policy and independent module publishing. Do not wait for all 26 packages to become feature-complete to publish a small, proven foundation.

## First PR scope

One typed Counter component: one signal, one event listener, two targeted text bindings, owner teardown and a compiled example verified through golden/unit/browser tests. This is deliberately narrower than the entire vision.

## Parallel work rules

No competing agents may change IR, signal scheduler or public TSX semantics without an ADR and coordinated versioning. Implement package-specific vertical slices in isolated branches; merge only when contract-dependent tests pass.
