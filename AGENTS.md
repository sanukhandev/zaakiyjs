# AGENTS.md — ZaakiyJS Engineering Contract

> Status: architecture and development policy. The repository is being initialized; planned APIs and packages are **not implemented** until their code, tests, and published artifacts exist.
> Read this file before any work. More detailed, authoritative contracts are indexed in [docs/README.md](docs/README.md).

## Mission and non-negotiable constraints

Build ZaakiyJS as an independent TypeScript/TSX, compiler-first frontend framework inspired by React, Angular, and Vue without depending on their runtimes. Compile typed components into optimized native DOM bindings using fine-grained signals; offer native-first utility CSS, scoped state, lifecycle ownership, page adapters, secure async/network layers, and optional Gemini-assisted optimization.

1. **One monorepo, independent npm releases:** every publishable `@zaakiyjs/*` package owns its package manifest, version, changelog, API compatibility policy, tests, build artifacts, and release provenance. A release of one package must not publish every package. Dependents release only when their declared compatibility requires it.
2. **Deterministic offline builds:** do not require Gemini, internet services, or AI-generated code during ordinary builds. Lock dependencies and generate reproducible output for pinned inputs.
3. **Independent runtime:** no required React, Vue, Angular, Zone.js, virtual DOM, or browser-loaded Gemini SDK. Reuse established TypeScript AST tooling, Vite, CSS tooling, pnpm, and tests; do not build another bundler/parser.
4. **Correctness before speed:** semantic equivalence, security, accessibility, reliable cleanup, and accurate source maps outrank microbenchmarks.
5. **SOLID + pragmatic MVVM:** Model contracts/domain logic, signal-based ViewModels, TSX Views, and page adapters have distinct responsibilities. Stateless presentational components need no artificial ViewModel. Favor small interfaces and composition over ceremonial classes.
6. **Strict TypeScript:** `strict: true`, typed props/events/HTML/SVG, no unnecessary `any`, explicit interfaces and stable public exports.
7. **Trust boundaries:** compiler and AI run in Node/CI; only minimal runtime ships to browsers. Server-only proxy config, credentials, and private code must never enter browser bundles.

## Read before editing

- [Architecture overview](docs/architecture/overview.md)
- [Compiler and versioned IR](docs/architecture/compiler-and-ir.md)
- [Signals, scopes, SOLID and MVVM](docs/architecture/reactivity-and-mvvm.md)
- [Styling, branding and motion](docs/architecture/styles-and-motion.md)
- [HTTP, async, proxy, interceptors and security](docs/architecture/networking-and-async.md)
- [Rendering and dynamic SEO](docs/architecture/rendering-and-seo.md)
- [AI trust and optimization](docs/architecture/ai-boundary.md)
- [Package boundaries](docs/development/monorepo-packages.md)
- [CLI and generator rules](docs/development/cli.md)
- [Quality and testing gates](docs/development/testing-and-quality.md)
- [Independent npm releases](docs/releasing/independent-npm.md)
- [Architecture decisions](docs/adr/0001-core-architecture.md)

If a contract is ambiguous, draft an ADR; do not silently invent an incompatible API.

## Repository/package rules

Use `apps/{playground,docs,benchmark}`, `packages/<name>`, `examples/`, `tests/`, `docs/{architecture,development,releasing,adr}`, `benchmarks/`, and `.github/workflows/` as the target shape. Use pnpm workspaces and Turborepo when bootstrapping. Not all folders/packages exist yet.

Initial foundation: `core`, `signals`, `dom`, `compiler`, `styles`, `vite-plugin`, `cli`, plus `testing` as quality tooling. Future packages: `store`, `forms`, `router`, `compat`, `async`, `http`, `proxy`, `motion`, `ui-primitives`, `ui`, `templates`, `ssr`, `seo`, `analytics`, `ads`, `consent`, `ai`, `devtools`. `create-zaakiyjs` is an optional separate initializer. Planned names are not evidence of npm scope ownership.

Respect dependency direction: app/templates -> UI/application modules -> core/signals/dom; build tools consume contracts but runtime packages never import compiler, CLI, AI or server-only proxy code. Use public package exports, not `../../other-package/src`. Avoid circular dependencies. Keep internal modules private until a stable public contract exists.

## Compiler and reactive DOM

Pipeline: TypeScript/TSX -> AST -> type/semantic analysis -> **versioned IR** -> safe optimization passes -> JS/CSS/maps/manifest -> Vite. Use IR nodes for static elements/text, dynamic text, properties/events, conditionals, keyed loops, components, style tokens and compatibility features. Preserve evaluation/side-effect order; unknown function calls are impure unless safely proven otherwise. Hoist static markup and emit targeted `Text.data`, attributes, properties, classes and styles—not component-wide rerenders.

Signals are the single reactive foundation: `signal`, lazy `computed`, `effect`, `batch`, `untrack`, `onCleanup`, controlled `flushSync`. Track dynamic dependencies, deduplicate scheduled work, detect cycles, preserve keyed DOM identity/focus, and dispose listeners/effects/owners on unmount.

Scopes: application -> route/page -> feature -> component, with explicit provider visibility/overrides and deterministic teardown. App singleton means **per application root**, never process-global across SSR requests. Local state flows top-down; mutations happen through explicit typed actions/callbacks. KeepAlive activation differs from suspension and permanent disposal.

## Styling, AI and server boundaries

`zaakiy.config.ts` is the intended brand source of truth: identity, typography, colors, spacing, responsive rules, modes and motion. `@zaakiyjs/styles` parses utility/recipe tokens and generates CSS at build time using native CSS features and browser-aware transforms; **no required Tailwind runtime/package**. AI may propose design recipes or allowlisted IR transformations only with explicit consent, redaction, schema checks, tests, benchmarks and human review. Never execute model-supplied arbitrary source code.

Use native `AbortController/AbortSignal` (no Promise patching) for scoped resources, tasks and HTTP requests. Enforce request timeouts, cancellation reasons, race protection, typed interceptors, auth boundaries and tenant-safe caches. Proxy routing is server-only with named destinations, allowlists, SSRF protections and request-scoped authorization; browser routes are separate.

Treat public SEO routes as SSR/SSG/hybrid targets with accurate status, metadata, canonical/JSON-LD, sitemaps and invalidation; private routes must not appear in indexes. Ads/analytics/consent stay opt-in.

## Development workflow

1. Read the existing code, docs, package manifest, previous ADRs and tests before changes.
2. Implement one vertical slice on a feature branch; keep code inside owned package boundaries.
3. Write the contract and failing tests before an optimization or behavioral change.
4. Run relevant typecheck, lint, unit, compiler golden, DOM integration, browser, security, accessibility and regression suites.
5. For changed public APIs or IR, update docs, migration guidance, compatibility tests and package change metadata.
6. For changed packages, record **per-package** size, dependency, performance and security impact. Verify production/browser/server bundles.
7. Never claim green CI, npm publication, production readiness or benchmark superiority without evidence.

## Pull request completion checklist

Every PR reports: objective/scope; packages and dependency graph affected; tests actually executed (with failures); generated JS/CSS examples when relevant; performance/bundle delta; security, privacy, accessibility; API and migration impact; **changeset/version intent for each independently published package**; and documentation changes.

CI blocks on failed correctness tests, ownership leaks, unsafe sinks/URLs, private key leakage, unapproved global patches, unexplained performance regressions, and unsupported API/IR changes. Do not bypass a gate to achieve a benchmark.

## npm publishing policy

- Package versions are **independent SemVer**. Use Changesets in independent mode (`fixed: []`, `linked: []`), documenting dependency-induced bumps when compatibility requires them.
- Every publishable package gets its own `name`, `version`, `exports`, `types`, `files`, `sideEffects` (accurate for CSS), `publishConfig.access: public`, README/changelog and artifact validation. Internal apps remain `private: true`.
- Build and test affected packages plus dependent compatibility tests; check `npm pack --dry-run`, exports/type declarations, package contents, license, and artifact provenance.
- Publish changed packages independently after approval, preferably using npm Trusted Publishing (OIDC) from GitHub-hosted Actions. Configure trusted-publisher authorization **for each npm package**. No long-lived write token in CI by default.
- Require explicit first-publication approval/namespace ownership verification; never publish or tag automatically from a docs-only change.
- See [independent npm release runbook](docs/releasing/independent-npm.md) for ordering, rollback and safe release gates.

## Done means

A feature is done only when a typed TSX example builds, semantics and disposal are tested, supported browsers and security boundaries are verified, artifacts are reproducible, public API/docs are current, and each impacted package has an explicit release decision. The first framework release must work completely with AI disabled.
