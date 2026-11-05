# @zaakiyjs/templates

Typed, deterministic, **draft** ZaakiyJS source template catalog: dashboard, authentication,
settings and product CRUD. Templates are ordinary editable TS/TSX project files, not a CMS,
runtime HTML interpreter, or a code-execution engine.

## Planning and materialization

```ts
import {listTemplates,createTemplatePlan,materializeTemplatePlan} from "@zaakiyjs/templates";
const plan = createTemplatePlan({
  template:"dashboard",
  projectName:"my-dashboard",
  options:{brandName:"Example",primaryColor:"#334ac0",appearance:"system",radius:"md"}
});
// plan.files is an immutable, pure, dry-run inventory. NO project writes occur.
const files = await materializeTemplatePlan(plan);
// A separate atomic CLI adapter must preflight and write files within its approved root.
```

**Status:** All templates are `draft`. No complete generated-app Vite/Playwright validation
has been obtained, so they must not be advertised as runnable or installed npm starters.
The currently checked compiler rejects some TSX forms. The P2 UI/template contract is not
on main as of this implementation; finalize compatibility and adapter shapes after P2-00.
No other package files were modified.

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

- Freeze P2 UI/template contract and verify compiler support with generated-app fixtures.
- Typecheck/build each generated app with the real Zaakiy Compiler and Vite plugin.
- Test keyboard/focus, form accessibility, mobile layouts, reduced motion in Playwright
  Chromium/Firefox/WebKit, plus security and stale cancellation flows.
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
