# ZaakiyJS engineering documentation

> **Current documentation:** [Site-ready package guides](site/index.md) cover the **22 source packages present on the reviewed main revision** (10df2c23a861), with feature usage, API inventories, integration recipes and explicit limitations. They are not npm publishing or production certification claims. Older M0/P2/P3 contract pages below preserve historical design decisions and may include dated status notes; current code, exports and tests take precedence.

## Start here

- [Package documentation home](site/index.md) — feature-oriented guide for all currently present packages.
- [Getting started](site/guides/getting-started.md) — setup, Counter TSX and Vite.
- [Feature integration](site/guides/feature-integration.md) — MVVM, state, network, forms, UI and privacy.
- [Architecture and limitations](site/guides/architecture-and-limitations.md).
- [Planned modules](site/planned-packages.md) — clearly separated unmerged/unimplemented modules.
- [AGENTS.md](../AGENTS.md) — required engineering rules.
- [M0 historical contracts](contracts/README.md) — precise package symbol ownership, versioned ABI and type-only baseline.
- [M0 ADR](adr/0002-m0-package-contract-boundaries.md) — dependency/contract decision.
- [Architecture overview](architecture/overview.md) — execution model, module boundaries.
- [Compiler and IR](architecture/compiler-and-ir.md) — optimizer safety and IR constraints.
- [Reactivity and MVVM](architecture/reactivity-and-mvvm.md) — signals, ownership and lifecycle.
- [Brand-driven CSS](architecture/styles-and-motion.md) — styles, recipes and motion.
- [Networking and async](architecture/networking-and-async.md) — Fetch/proxy/AbortController.
- [Rendering and SEO](architecture/rendering-and-seo.md) — SSR/SSG/hydration architecture.
- [AI boundary](architecture/ai-boundary.md) — reviewed Gemini proposals.
- [Monorepo and package boundaries](development/monorepo-packages.md) — packaging and dependency rules.
- [CLI and code generators](development/cli.md) — developer commands and generator contracts.
- [Testing and quality](development/testing-and-quality.md) — validation policy.
- [Implementation roadmap](development/implementation-plan.md) — milestone gates.
- [Independent npm publishing](releasing/independent-npm.md) — separate SemVer and approval.
- [ADR 0001](adr/0001-core-architecture.md) — initial architecture.

## Historical contracts and ADRs

**Agreed direction** is an engineering choice, **reserved API** is explicitly NOT a runtime export, and **release gate** is a requirement, not evidence of a passing workflow. Public ABI or owner changes require an ADR.

### P2 UI architecture

- [ADR 0007](adr/0007-p2-ui-contract-boundaries.md)
- [UI primitives](contracts/09-ui-primitives.md), [UI](contracts/10-ui.md), [Motion](contracts/11-motion.md), [Templates](contracts/12-templates.md) — original frozen contracts; consult current package guides for present implementation.
- [Compiler enhancement issue #37](https://github.com/sanukhandev/zaakiyjs/issues/37) — ref/children/slot boundaries.

### P3 rendering, SEO and privacy

- [ADR 0009](adr/0009-p3-rendering-privacy-boundaries.md) — package boundaries.
- [SSR](contracts/13-rendering-ssr.md), [SEO](contracts/14-seo.md), [Consent](contracts/15-consent.md), [Analytics](contracts/16-analytics.md), [Ads](contracts/17-ads.md) — original protocols; only consult package pages for runtime behavior that exists on main.
- [Dependency/integration matrix](contracts/p3-dependency-integration-matrix.md) and [rendered-page ownership fixture](contracts/p3-page-ownership-example.md).
