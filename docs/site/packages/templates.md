---
title: "@zaakiyjs/templates"
description: "Deterministic editable project templates, manifests, integrity checks and dry-run plans"
sidebar_position: 18
---

# @zaakiyjs/templates

Use Templates to obtain audited TSX source starters for dashboard, authentication, settings and CRUD, not a runtime renderer.

> **Availability:** Source implementation in ZaakiyJS, not a verified published npm release. The package's manifest at the referenced revision uses `0.0.0`; use workspace tooling until independent publishing is approved.

## At a glance

- **Use it when:** Select a template, build an immutable plan, inspect files, and separately apply through an authorized writer.
- **Reference revision:** [9f6c6603c98c](https://github.com/sanukhandev/zaakiyjs/commit/9f6c6603c98ca566c2fed6fed34cc770f6a72960).

## Try it in the monorepo

```sh
pnpm --filter @zaakiyjs/templates typecheck
pnpm --filter @zaakiyjs/templates test
pnpm --filter @zaakiyjs/templates build
```

## Feature usage: first working pattern

```ts
import { listTemplates, createTemplatePlan } from '@zaakiyjs/templates';
import { materializeTemplatePlan } from '@zaakiyjs/templates/node';

console.log(listTemplates());
const plan = createTemplatePlan({
  template: 'dashboard', projectName: 'my-dashboard',
  options: { brandName: 'Example', primaryColor: '#334ac0', appearance: 'system', radius: 'md' }
});
const files = await materializeTemplatePlan(plan);
// Validate and write these files through a separate atomic CLI adapter.
```

## Usage and correctness guidelines

- `materializeTemplatePlan` produces content; it does not write project files.
- Template status and `workspace:^` dependencies are not proof that a template can install from public npm.
- Authentication template repositories deliberately fail closed and require production server/session implementations.

## Public API index

Exported symbols detected in the package root `src/index.ts`. Platform-specific subpaths and structural contracts are explained in the detailed guide and package manifest.

- `Appearance`
- `MaterializedFile`
- `PlanDiagnostic`
- `PlanRequest`
- `PlannedTemplateFile`
- `PlannedWrite`
- `Radius`
- `TemplateAsset`
- `TemplateCapability`
- `TemplateCategory`
- `TemplateCompatibility`
- `TemplateError`
- `TemplateFilePlan`
- `TemplateId`
- `TemplateKind`
- `TemplateManifest`
- `TemplateManifestV1`
- `TemplateOptionSpec`
- `TemplateOptions`
- `TemplatePlan`
- `TemplateRequest`
- `TemplateStatus`
- `createTemplatePlan`
- `getTemplate`
- `listTemplates`
- `planTemplate`
- `safeRelativePath`
- `sha256Utf8`
- `validateMaterializedFiles`
- `validateProjectName`
- `validateTemplate`

## Detailed feature guide

### Contract 12 — browser-safe manifests and deterministic plans

`@zaakiyjs/templates` exports browser-safe metadata and pure validation/planning:
`getTemplate`, `listTemplates`, `validateTemplate`, `planTemplate`,
`sha256Utf8`, and the convenience `createTemplatePlan`.

Each manifest includes independent version, project/page kind, license policy,
compiler/DOM ABI/IR compatibility, exact framework packages, and SHA-256 for
every packaged asset. The raw UTF-8 source asset map is **injected explicitly**
to `planTemplate` using `assetContents` (a documented additive input to the
frozen Contract 12 request type); the metadata entrypoint never bundles source
files, imports Node, accesses the network, or writes the filesystem.

`planTemplate` verifies raw checksums and safe, typed replacement variables.
Its immutable write plan includes deterministic content SHA-256, sorted paths,
collision diagnostics, and authorization hashes for any replacements.
An atomic, symlink-resistant CLI adapter must revalidate authorization hashes
and the target root before actually writing. No CLI writer runs implicitly.

### Planning and materialization

```ts
import {listTemplates,createTemplatePlan} from "@zaakiyjs/templates";
import {materializeTemplatePlan} from "@zaakiyjs/templates/node";
const plan = createTemplatePlan({
  template:"dashboard",
  projectName:"my-dashboard",
  options:{brandName:"Example",primaryColor:"#334ac0",appearance:"system",radius:"md"}
});
// plan.files is an immutable, pure, dry-run inventory. NO project writes occur.
const files = await materializeTemplatePlan(plan);
// A separate atomic CLI adapter must preflight and write files within its approved root.
```

Only integration-required `pnpm-lock.yaml`, workspace package validation and the
dedicated browser workflow are modified outside `packages/templates`.

### Architecture and integration contract

Registry descriptors contain IDs, categories, required packages, minimum compatible versions,
feature flags, required compiler features, options, status and exact source paths.
`createTemplatePlan` validates project names, typed options, relative paths and collisions
without I/O; `materializeTemplatePlan` only reads packaged, non-symlink static text assets.
No arbitrary scripts or network calls run. It does not perform writes.

The CLI integration PR should import these public functions, reject `status !== "runnable"`
for normal execution (unless an explicit experimental opt-in is implemented), call the
existing atomic transactional writer after validating target scope, and support a dry-run
list before touching the filesystem. It must prohibit silent overwrite and symlink escapes,
with tests for TOCTOU and rollback. No CLI change is part of this branch.

Current template Views use semantic native elements and static brand utility tokens instead of importing UI internals. Adoption of public UI components is a separate, tested integration decision. No chart dependency or JavaScript theme engine.

### Auth/security policies

No default credentials, tokens, OAuth secrets or production identity assertions exist.
Auth has an explicit `AuthRepository` contract and a fail-closed unconfigured adapter.
Server owners must implement backend authentication, CSRF/session protection, httpOnly
session cookies, verified role/permission enforcement, rate limiting, expiry, reset-token
one-time semantics, and MFA. LocalStorage is not used for tokens. Demo fixtures in the
Dashboard are labeled as such. The settings repository requires version checks to avoid
lost updates; CRUD deletion requires confirmation and is never automatically retried.

### Work still required before making the catalog runnable

- Frozen P2 Contract 12 is implemented; verify future contract/ABI revisions through tests.
- Verify generated-app TypeScript/Zaakiy Compiler/Vite build gates remain green in CI.
- Retain the passing generated-app Chromium/Firefox/WebKit matrix with axe,
  responsive layout, and keyboard tests; expand repository-backed authorization,
  cancellation-race, CSP and security cases before enabling production presets.
- Verify clean npm consumption and per-package release, lockfile and packed artifacts.

The generated package manifest uses `workspace:^` intentionally: it requires this
repository's packages and does **not** imply independent npm installability.

### Commands (workspace)

```sh
pnpm --filter @zaakiyjs/templates lint
pnpm --filter @zaakiyjs/templates typecheck
pnpm --filter @zaakiyjs/templates test
pnpm --filter @zaakiyjs/templates build
pnpm --filter @zaakiyjs/templates pack:check
```

## Integrate with neighboring packages

- [@zaakiyjs/cli](./cli.md)
- [@zaakiyjs/styles](./styles.md)
- [@zaakiyjs/ui](./ui.md)
- [@zaakiyjs/compiler](./compiler.md)

## Source and maintenance

- [Package README](https://github.com/sanukhandev/zaakiyjs/blob/9f6c6603c98ca566c2fed6fed34cc770f6a72960/packages/templates/README.md)
- [Public source exports](https://github.com/sanukhandev/zaakiyjs/blob/9f6c6603c98ca566c2fed6fed34cc770f6a72960/packages/templates/src/index.ts)
- [Package test cases](https://github.com/sanukhandev/zaakiyjs/tree/9f6c6603c98ca566c2fed6fed34cc770f6a72960/packages/templates/test)
- Update this page when public APIs, runtime semantics or platform guarantees change.
