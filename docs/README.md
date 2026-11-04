# ZaakiyJS Engineering Documentation

> **Current state:** specification and repository bootstrap only. No framework modules, CLI commands, CI gates or npm releases have been implemented or validated yet.
> **Repository:** sanukhandev/zaakiyjs. **Scope:** `@zaakiyjs/*` (ownership must be verified before first publication).

## Start here

- [AGENTS.md](../AGENTS.md) — mandatory rules for coding agents, contributors, and pull requests.
- [Architecture overview](architecture/overview.md) — boundaries, 26 proposed packages and system map.
- [Compiler and IR](architecture/compiler-and-ir.md) — TSX lowering, deterministic optimizations and semantic guards.
- [Reactivity and MVVM](architecture/reactivity-and-mvvm.md) — signals, state ownership, lifecycle, SOLID and ViewModels.
- [Brand-driven CSS and motion](architecture/styles-and-motion.md) — native styling, utility extraction, UI primitives and animation.
- [Networking and async](architecture/networking-and-async.md) — typed Fetch, interceptors, proxy security, AbortController.
- [Rendering and SEO](architecture/rendering-and-seo.md) — SSG/SSR, route metadata, dynamic content and cache invalidation.
- [AI boundary](architecture/ai-boundary.md) — optional Gemini usage with consent, deterministic validation and audit.
- [Monorepo and package boundaries](development/monorepo-packages.md) — directory layout, dependency rules and published names.
- [CLI and code generators](development/cli.md) — `start --project`, MVVM scaffolds and future commands.
- [Testing and quality](development/testing-and-quality.md) — unit, compiler, browser, security and performance gates.
- [Implementation plan](development/implementation-plan.md) — milestone order, first vertical slice and risks.
- [Independent npm publishing](releasing/independent-npm.md) — package-level SemVer, Changesets, OIDC and rollout/rollback.
- [ADR 0001](adr/0001-core-architecture.md) — baseline decisions and still-open contracts.

## Terminology

**Agreed direction** is a product/engineering decision; **proposed API** is illustrative until implemented, tested and documented as public; **release gate** is a requirement, not evidence that the gate currently runs.

Changes to public APIs, the IR schema, ownership semantics, rendering output, publishing process or security boundary require an ADR. Production readiness is established by evidence, not by the presence of documentation.

## Monorepo/release policy

Single pnpm workspace, independent npm packages. A package publishes only when a meaningful release is needed or a dependency compatibility bump requires it. App/demo folders remain private. Never globally synchronize package version numbers. Follow [release runbook](releasing/independent-npm.md).
