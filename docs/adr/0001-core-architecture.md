# ADR 0001 — Foundational Framework and Release Boundaries

- **Status:** Proposed architecture baseline; implementation pending
- **Date:** 2026-11-04
- **Scope:** Core compiler/runtime, app model, styling, tooling and monorepo publishing

## Context

ZaakiyJS aims to be an independent compiler-first TypeScript frontend framework with fine-grained signals, direct DOM updates, app-scoped providers, SOLID/MVVM feature boundaries, native CSS/branding, secure async networking and optional Gemini recommendations. Package boundaries should remain modular while all code shares one repository.

## Decisions

1. Use TSX/TypeScript with a versioned compiler IR; native DOM targeted bindings, not mandatory Virtual DOM.
2. Signals are the single reactivity foundation; lifecycle owners handle disposal; app-scoped singleton providers are not process-global SSR singletons.
3. Develop feature slices using Model, ViewModel, View and Page Adapter separation with dependency inversion.
4. Brand config, not theme API, is primary styling configuration; Tailwind-inspired but not Tailwind-dependent CSS.
5. Native Promise/AbortSignal, typed HTTP/interceptors and server-only named-upstream proxy form networking contracts.
6. SSR/SEO capability must be feasible in initial IR designs, but implementation follows proven core rendering.
7. Gemini is optional and review-gated; deterministic offline builds are mandatory.
8. Use a pnpm monorepo with **independent SemVer/npm publication per package** and Changesets independent mode; do not ship placeholder modules.
9. CLI scaffolding convention: `npx @zaakiyjs/cli@latest start --project my-app`; `dev` is separate.
10. Preserve security, accessibility, source diagnostics and reproducible benchmarks as first-class requirements.

## Consequences

A stronger contract-first phase is required. Cross-package changes need compatibility tests, and the initial release scope must be narrow. Independent publication increases dependency/version matrix work but prevents unnecessary publishing of unchanged modules.

## Still to resolve via future ADRs

- Exact TSX reactive expression semantics, edge cases and server rendering.
- Dynamic signal tracking and scheduler flush ordering.
- Compiler IR version compatibility and plugin extension APIs.
- KeepAlive/suspension/async resource scheduling.
- SSR request scope/hydration mismatch handling.
- Shared cache invalidation security model.
- CSS utility namespace, generated style hash stability.
- Peer dependency policy between independently released packages.
- Exact npm publishing workflow and release authorization.
