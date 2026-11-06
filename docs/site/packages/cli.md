---
title: "@zaakiyjs/cli"
description: "Project scaffolding, safe generators, diagnostics and script delegation"
sidebar_position: 7
---

# @zaakiyjs/cli

Use the CLI to create TypeScript/TSX applications and scaffold typed MVVM building blocks.

> **Availability:** Implemented source package in the repository, not a verified public npm release. All package manifests on the referenced commit are `0.0.0`; install from this workspace until independent publishing is approved.

## At a glance

- **Primary use:** Prefer `start --project`; the `create` command is not the framework command.
- **Runtime boundary:** See the package README and public export map before importing into browser/server code.
- **Source revision:** [9f6c6603c98c](https://github.com/sanukhandev/zaakiyjs/commit/9f6c6603c98ca566c2fed6fed34cc770f6a72960).

## Try it from the monorepo

```sh
pnpm --filter @zaakiyjs/cli typecheck
pnpm --filter @zaakiyjs/cli test
pnpm --filter @zaakiyjs/cli build
```

## Feature usage: first working pattern

```sh
npx @zaakiyjs/cli@latest start --project my-app
zaakiy start --project my-app --template minimal
zaakiy generate feature products --architecture mvvm
zaakiy g component ProductCard --dry-run
zaakiy doctor --json
zaakiy dev
zaakiy build
zaakiy test
```

The `npx` line is the intended command **after publication**; package manifests currently use unreleased `0.0.0` versions. Use workspace scripts for source checkout testing.

## Usage and correctness guidelines

- Scaffolding does not silently run package installation or arbitrary template scripts.
- Only the documented generators are available; unsupported generators fail without creating files.
- Dry-run, path validation, rollback and explicit force options protect project files.

## Public API index

These are exported public symbols detected in `src/index.ts` at the source revision. Check types and package `exports` for supported subpaths and platform requirements.

- `CliCommandName`
- `CliDiagnostic`
- `CliError`
- `CliIO`
- `CliInvocation`
- `CliResult`
- `diagnoseProject`
- `foundationStatus`
- `generatorPlan`
- `parseArgs`
- `parsePreset`
- `scaffoldPlan`
- `scaffoldProject`
- `supportedGenerators`
- `validateProjectName`

## Detailed feature guide

Sections below retain capability explanations and examples from the package's source README, not unimplemented proposals. Technical limitations inside a section remain applicable.

### Commands

    npx @zaakiyjs/cli@latest start --project my-app
    zaakiy start --project my-app --template minimal
    zaakiy start --project my-app --template standard
    zaakiy start --project my-app --template enterprise
    zaakiy start --project my-app --dry-run
    zaakiy g component MyButton
    zaakiy generate feature products --architecture mvvm
    zaakiy g viewmodel Cart --dry-run
    zaakiy g service Inventory --force
    zaakiy dev
    zaakiy build
    zaakiy test
    zaakiy doctor
    zaakiy doctor --json

The executable is named **zaakiy**. Project creation uses **start --project**, not create.

- **Minimal:** strict TSX Counter, typed branding, native mount and the Vite plugin. Scaffolding outside a workspace is gated by framework package readiness and non-placeholder published versions; source package manifests currently use 0.0.0.
- **Standard:** Minimal plus organized shared/feature directories; no unimplemented runtime imports.
- **Enterprise:** Standard plus application provider/branding and MVVM documentation structure; no router, forms, async resources or proxy APIs.

Project creation never installs dependencies or runs template scripts. Run your package manager's install command explicitly before dev/build/typecheck. Supported tools: Node 20.19+, npm 10+, pnpm 10+, Yarn 4+. Use --workspace only with --package-manager pnpm and an included target path (for example, --path packages in a workspace whose pnpm-workspace.yaml includes packages/*).

generate/g supports component, view, viewmodel, model, feature, service, provider, context. Feature generation uses Model repository interfaces, an owner-scoped signal-based ViewModel with native AbortController cancellation and stale-result protection, a typed TSX View, a service gateway and an owner adapter. The context and provider generators use the real @zaakiyjs/core scoped context API. Stateless components do not need ViewModels.

--dry-run shows the file plan, --force explicitly enables replacement, and --path selects a project-relative output directory. Path traversal, symlinks and Windows device names are rejected. Repeating a generator with unchanged content is a no-op; divergent files require --force. Files are staged before creation, failures trigger rollback, and unrecoverable backup restoration preserves recovery artifacts.

dev/build/test delegate to real project scripts, forward subprocess exit codes and handle termination signals. doctor inspects required files, strict TSX configuration, framework package declarations/exports and the Vite plugin configuration. It does not substitute for a production build.

page, layout, store, resource, task, interceptor, proxy, analyze, migrate, seo and ai are unavailable until their owning packages are implemented. They fail without creating files.

### Publication requirements

Before marking the PR ready, install packed packages in a clean fixture; verify generated typecheck, Vite production build, native DOM interaction, security tests, CLI executable, npm pack and provenance. The M0-only baseline cannot satisfy these gates. The branch includes a scoped pnpm lockfile update for CLI Node typings. Current CI passes lint/typecheck/build/test and validates pnpm-packed CLI invocation, but a clean compiled Counter production build remains blocked on the other foundation packages.

## Integrate with neighboring packages

- [@zaakiyjs/vite-plugin](./vite-plugin.md)
- [@zaakiyjs/core](./core.md)
- [@zaakiyjs/templates](./templates.md)
- [@zaakiyjs/styles](./styles.md)

## Source and maintenance

- [Package README](https://github.com/sanukhandev/zaakiyjs/blob/9f6c6603c98ca566c2fed6fed34cc770f6a72960/packages/cli/README.md)
- [Public exports](https://github.com/sanukhandev/zaakiyjs/blob/9f6c6603c98ca566c2fed6fed34cc770f6a72960/packages/cli/src/index.ts)
- [Package tests](https://github.com/sanukhandev/zaakiyjs/tree/9f6c6603c98ca566c2fed6fed34cc770f6a72960/packages/cli/test) (some packages use `tests/`)
- Update this guide in the same PR that changes public APIs, compiler/DOM behavior, security rules or feature support.
