# Monorepo Packages, Ownership and Dependency Rules

## Repository layout (target)

```text
zaakiyjs/
├── apps/{playground,docs,benchmark}/       # private apps
├── packages/{core,signals,dom,compiler,...}/
├── examples/
├── tests/{runtime,compiler-golden,integration,e2e,security}/
├── benchmarks/
├── docs/{architecture,development,releasing,adr}/
├── scripts/
├── .changeset/
├── .github/workflows/
├── AGENTS.md
├── pnpm-workspace.yaml
├── turbo.json
└── tsconfig.base.json
```

Use pnpm workspaces, a single lockfile, Turborepo task graph and pinned tool versions. The layout is **planned**; folders not yet implemented must not be treated as available packages. Root and app workspaces are `private: true`.

## 27 logical modules

| Proposed `@zaakiyjs/` suffix | Environment | Boundary and role |
| --- | --- | --- |
| `core` | Browser | Component contracts, ownership, context and lifecycle |
| `signals` | Browser | Fine-grained reactive graph, scheduler and computed |
| `dom` | Browser | DOM binding helpers, keyed identity and event cleanup |
| `compiler` | Node/build | AST, IR, optimization and JavaScript emission |
| `styles` | Build + CSS | Brand tokens, utility extraction, CSS recipes |
| `image` | Browser-safe descriptor + Node build | Local responsive raster optimization (Sharp adapter), picture markup, immutable image manifest |
| `vite-plugin` | Node/build | Compiler + Vite, HMR and source maps |
| `cli` | Node | Starters, generators, diagnostics, migrations |
| `store` | Browser | Local/app/route store abstractions and explicit actions |
| `forms` | Browser | Typed fields, validation and form scopes |
| `router` | Browser/server-adapter | Page routing, adapters, guards and loaders |
| `compat` | Build/optional browser | Target analysis, manifests and approved shims |
| `async` | Browser/server | Resource/task state, cache, abort and retries |
| `http` | Browser/server | Typed Fetch and interceptors |
| `proxy` | Server/edge only | Authenticated upstream proxy, SSRF protection |
| `ui-primitives` | Browser | Accessible unstyled behavior |
| `ui` | Browser + CSS | Brand-aware visual components |
| `templates` | Source/templates | Editable TSX page templates |
| `motion` | Optional browser | Presence, WAAPI, gestures, spring |
| `ssr` | Server/build + client hydration | SSG/SSR and hydration |
| `seo` | Server/build | Dynamic metadata, structured data and sitemaps |
| `analytics` | Optional browser/server | Metrics and event adapters |
| `ads` | Optional browser | Ad integrations and slots |
| `consent` | Optional browser | Consent state and integrations |
| `ai` | Node/CI only | Reviewed Gemini advice and optimization |
| `devtools` | Development | Signal, network, DOM, lifecycle tracing |
| `testing` | Development | Testing helpers and cross-package fixtures |

`create-zaakiyjs` could be a separate initializer later, but the intended starter command is `npx @zaakiyjs/cli@latest start --project my-app`.

## Dependency direction

The runtime dependency graph flows from optional application packages to stable `core`/`signals`/`dom` contracts. No browser package imports `cli`, `compiler`, `ai` or `proxy`. Build-time tooling consumes runtime contracts but runtime code must not import build tooling. For cross-package usage, import public `exports`, not private `../other/src`. Avoid circular dependencies and unsupported package conditions.

`ui` composes `ui-primitives` and stylesheet output; `templates` compose UI. Forms and ViewModels use signals and resource abstractions rather than building their own reactive schedulers. Global providers are app-root scoped; SSR user state is request scoped.

## Publishable package metadata

Each real publishable package independently owns: `package.json` name/version, API exports/types, ESM build, accurate `sideEffects` (especially CSS), `files`, `README.md`, license, changelog, tests, platform/Node engines, peer/dependency ranges, release notes and `publishConfig.access: "public"`.

Example **future** package manifest (not yet created):

```json
{
  "name": "@zaakiyjs/signals",
  "version": "0.1.0",
  "type": "module",
  "files": ["dist", "README.md"],
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "sideEffects": false,
  "publishConfig": { "access": "public" }
}
```

Do not mark side-effectful CSS imports as tree-shakeable. Build and test each package independently from its packed tarball.

## Code ownership and changes

Assign clear reviewers when teams exist. Public IR or core lifecycle changes require an ADR and compatible downstream tests. For any change affecting multiple packages, report their individual build sizes, dependency impact and per-package release decision. Independent versions **do not** mean dependents can skip compatibility bumps.

Read [release runbook](../releasing/independent-npm.md) before adding automation.
