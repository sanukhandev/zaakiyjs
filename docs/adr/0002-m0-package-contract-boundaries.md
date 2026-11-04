# ADR 0002 — Seven-package M0 contract bootstrap

- **Status:** Accepted for M0 scaffolding; behavioral details are provisional
- **Date:** 2026-11-04
- **Applies to:** signals, core, dom, compiler, styles, vite-plugin, cli

## Context

Seven independent implementation agents require a compiling baseline and source-compatible interface vocabulary before production code exists. Publishing fake implementations or prematurely coupling compiler AST objects to runtime would make the integration unsafe.

## Decision

Create seven separately versioned ESM pnpm workspace packages at `0.0.0`. Expose *only* type contracts and clearly marked `foundationStatus` runtime markers. `IR_SCHEMA_VERSION = 1` is a real serialization constant, not an operational compiler. Preserve the three quality CI job names. Use strict TypeScript, Vitest, ESLint and dependency-ordered builds.

The dependency topology is `signals -> core -> dom` plus `signals -> dom`, `compiler + styles -> vite-plugin -> cli`; never import Node build modules into browser runtime. `@zaakiyjs/dom/compiler` is reserved for compiler-generated browser ABI, while TSX types are exported at `@zaakiyjs/core/jsx-runtime`. The initial TSX fixture uses preserve/noEmit mode; no JSX runtime or DOM compilation is claimed.

## Consequences

Baseline packages can pass package-level import, ESM build and type compatibility tests without implementing business behavior. Framework runtime claims remain explicitly blocked. The M1-M2 agents must implement only their owned symbols and add behavioral fixtures. Incompatible changes to scheduling, owners, TSX, IR, CSS, or generated ABI require an ADR and cross-package review. Per-package releases remain independent; there is no automatic publication.
