# ZaakiyJS Engineering Documentation

> **Current state:** Seven foundation implementation slices are merged. Workspace lint, strict typecheck, build, 229 passing unit/integration tests and 24/24 Playwright Chromium/Firefox/WebKit acceptance cases verify the restricted M1 native-element control-flow path. This is **not** full-browser-target certification or independent npm release readiness: advanced TSX grammar, compatibility transforms, memory/benchmark evidence and release/SSR/SEO gates remain open. The historical M0 documents below do not describe today's implementation status.

## Start here

- [AGENTS.md](../AGENTS.md) — required engineering rules.
- [M0 contracts](contracts/README.md) — precise seven-package symbol ownership, reserved ABI, and type-only status.
- [M0 ADR](adr/0002-m0-package-contract-boundaries.md) — dependency/contract decision.
- [Architecture overview](architecture/overview.md) — execution model, module boundaries.
- [Compiler and IR](architecture/compiler-and-ir.md) — optimizer safety and IR constraints.
- [Reactivity and MVVM](architecture/reactivity-and-mvvm.md) — signals, ownership and lifecycle.
- [Brand-driven CSS](architecture/styles-and-motion.md) — styles, recipes and motion.
- [Networking and async](architecture/networking-and-async.md) — Fetch/proxy/AbortController.
- [Rendering and SEO](architecture/rendering-and-seo.md) — planned SSR/SSG/hydration.
- [AI boundary](architecture/ai-boundary.md) — reviewed Gemini proposals.
- [Monorepo and package boundaries](development/monorepo-packages.md) — packaging and dependency rules.
- [CLI and code generators](development/cli.md) — proposed developer commands.
- [Testing and quality](development/testing-and-quality.md) — validation policy.
- [Implementation roadmap](development/implementation-plan.md) — milestone gates.
- [Independent npm publishing](releasing/independent-npm.md) — separate SemVer and approval.
- [ADR 0001](adr/0001-core-architecture.md) — initial architecture.

## Terminology

**Agreed direction** is an engineering choice, **reserved API** is explicitly NOT a runtime export, and **release gate** is a requirement, not evidence of a passing workflow. Changes to public APIs/IR/ownership/rendering/security require an ADR. Packages start at an M0 unimplemented baseline, not a release.

## P2 UI architecture freeze (contract-only)

- [ADR 0007 — P2 UI packages and compiler boundaries](adr/0007-p2-ui-contract-boundaries.md).
- [UI primitives](contracts/09-ui-primitives.md), [UI components](contracts/10-ui.md), [Motion](contracts/11-motion.md), [Templates](contracts/12-templates.md) — future TypeScript contracts, **not implemented exports**.
- [Issue #37](https://github.com/sanukhandev/zaakiyjs/issues/37) — compiler-native refs/component slots, safe dynamic variants and exit-aware regions are separately gated.

## P3 rendering, SEO and privacy design contracts (contract-only)

- [ADR 0009 — P3 cross-package boundaries](adr/0009-p3-rendering-privacy-boundaries.md) defines import direction, trust, versioning and explicit deferrals.
- [SSR and hydration](contracts/13-rendering-ssr.md), [SEO](contracts/14-seo.md), [Consent](contracts/15-consent.md), [Analytics](contracts/16-analytics.md), [Ads](contracts/17-ads.md) reserve interoperable v1 protocols; **no P3 runtime or compiler server-output implementation is included**.
- [Dependency/integration matrix](contracts/p3-dependency-integration-matrix.md) and [rendered-page ownership fixture](contracts/p3-page-ownership-example.md) define future interop and acceptance tests.
