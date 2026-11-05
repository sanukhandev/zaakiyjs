# @zaakiyjs/templates

Typed, deterministic, **draft** ZaakiyJS source template catalog: dashboard, authentication,
settings and product CRUD. Templates are ordinary editable TS/TSX project files, not a CMS,
runtime HTML interpreter, or a code-execution engine.

## Contract 12 — browser-safe manifests and deterministic plans

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

## Planning and materialization

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

**Status:** All four projects typecheck and Vite production-build against the current
pinned compiler/runtime. The dedicated generated-app Playwright workflow runs
Chromium, Firefox and WebKit at 1280px and 390px, exercising real interactions
and axe-core WCAG 2.0/2.1 A/AA assertions. Packaged source integrity is checked.
The most recent successful CI run should be checked on the PR before promotion.
Templates retain the **draft** catalog status until clean external npm consumption,
published package version compatibility, and CLI/UI integration are certified.
Contract 12 is frozen and implemented in this package.
The compiler does not currently lower `htmlFor` to a native label association;
generated Views use enclosing HTML labels instead of relying on that mapping.

Only integration-required `pnpm-lock.yaml`, workspace package validation and the
dedicated browser workflow are modified outside `packages/templates`.

## Architecture and integration contract

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

`@zaakiyjs/ui` will be adopted only after its public exports and browser compatibility
are validated. Current draft Views use semantic native elements and static brand utility
tokens rather than copying UI internals. No chart dependency or JavaScript theme engine.

## Auth/security policies

No default credentials, tokens, OAuth secrets or production identity assertions exist.
Auth has an explicit `AuthRepository` contract and a fail-closed unconfigured adapter.
Server owners must implement backend authentication, CSRF/session protection, httpOnly
session cookies, verified role/permission enforcement, rate limiting, expiry, reset-token
one-time semantics, and MFA. LocalStorage is not used for tokens. Demo fixtures in the
Dashboard are labeled as such. The settings repository requires version checks to avoid
lost updates; CRUD deletion requires confirmation and is never automatically retried.

## Work still required before making the catalog runnable

- Frozen P2 Contract 12 is implemented; verify future contract/ABI revisions through tests.
- Verify generated-app TypeScript/Zaakiy Compiler/Vite build gates remain green in CI.
- Retain the passing generated-app Chromium/Firefox/WebKit matrix with axe,
  responsive layout, and keyboard tests; expand repository-backed authorization,
  cancellation-race, CSP and security cases before enabling production presets.
- Verify clean npm consumption and per-package release, lockfile and packed artifacts.

The generated package manifest uses `workspace:^` intentionally: it requires this
repository's packages and does **not** imply independent npm installability.

## Commands (workspace)

```sh
pnpm --filter @zaakiyjs/templates lint
pnpm --filter @zaakiyjs/templates typecheck
pnpm --filter @zaakiyjs/templates test
pnpm --filter @zaakiyjs/templates build
pnpm --filter @zaakiyjs/templates pack:check
```
