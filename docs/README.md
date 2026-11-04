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
