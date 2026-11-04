# Independent npm Deployment and Release Runbook

> **Design rule:** one repository, **individually versioned** npm modules, package-specific deployment. No modules have been built or published yet. Release pipelines and npm trusted-publisher associations still need to be implemented.

## 1. Versioning strategy

Every `@zaakiyjs/*` package owns its own SemVer version, changelog and published artifact. Do not align versions simply because packages share a repository.

Example: `@zaakiyjs/signals@0.3.1` can publish independently while `@zaakiyjs/styles@0.2.4` stays unchanged. Conversely, changing a compiler/runtime protocol may require coordinating several releases even though their version numbers remain independent.

Use Changesets in independent mode: `fixed: []` and `linked: []`. For each user-visible change, create a package-specific changeset or record a no-release decision. During 0.x releases, document breaking API conventions explicitly.

## 2. Package contract

Before first publication, verify namespace ownership and metadata. Each package needs:

- Unique `name`, independent `version`, correct `exports`, `types`, `files`, accurate `sideEffects` and supported environments.
- `publishConfig.access: public` for public scoped modules, README, license, changelog and stable public API documentation.
- Built JavaScript/types/source maps, test fixtures, packaging checks and clean-room consumer installation.
- Platform-sensitive export boundaries: no `@zaakiyjs/proxy`, `@zaakiyjs/ai` or compiler Node code in browser bundles.

Unpublished apps, examples and fixture packages remain `private: true`.

## 3. Release change flow

1. **Code PR:** identify changed packages; add independent changesets with intended SemVer bump; run unit/golden/browser/security and dependent compatibility tests.
2. **Release PR:** use Changesets to compute exact package versions, dependency-range updates and per-package changelogs. Review changes, including peer dependency policies.
3. **Build in dependency order:** topologically build and pack changed packages. Test each packed artifact in a clean consumer fixture.
4. **Approve publication:** publish **only** packages that need a new registry version and have passing gates; changed dependent ranges may necessitate dependent releases.
5. **Verify:** check exact npm versions, dist tags and registry artifacts, install from registry and run consumer tests.
6. **Tag and announce:** use package-prefixed tags such as `@zaakiyjs/signals@0.3.1`, release notes and linked source commits.

Never run `npm publish -ws` blindly. A docs-only commit or unrelated module change must not release all packages.

## 4. Changesets implementation

The repository includes an independent-mode `.changeset/config.json` as a bootstrap policy. Installing/configuring Changesets CLI and release workflows is a later development task. Proposed future steps, not currently executable here:

```bash
pnpm changeset
pnpm changeset status
pnpm changeset version
pnpm -r build
pnpm --filter @zaakiyjs/signals exec npm pack --dry-run --json
# Publish through reviewed CI workflow, not arbitrary local bulk publishing.
```

Choose a compatible Changesets version and review peer/dependency update behavior. Avoid release loops from workspace protocol ranges. Keep `workspace:^` or explicit ranges consistent with the supported pnpm/Changesets versions and verify resolved package manifests before publishing.

## 5. Credentials and provenance

Prefer **npm Trusted Publishing (OIDC)** via GitHub-hosted Actions when available for the account/package. Each npm package requires its own trusted-publisher mapping to the correct repository and workflow. Do not rely on an application-wide token; never put a token in source or run publishing on untrusted pull requests.

Release jobs need environment review/branch protections, least-privilege tokens, dependency audit, action pinning and provenance. Require manual approval for first publication of each new package. Don't call a package released until the registry confirms it.

## 6. Failure and rollback

If publishing fails midway, do not automatically re-run a bulk publish. Inspect which versions actually exist, then resume only missing modules in dependency order. Never reuse an npm version number for changed bytes. For broken releases, prefer deprecation of affected version plus corrected patch release; unpublish only according to npm policy and with explicit authorization. Fix dist tags deliberately and run downstream consumers again.

If a package change introduces a breaking protocol incompatibility, pause dependent publication until an approved version matrix or migration exists.

## 7. Release readiness checklist

- Package published scope/ownership confirmed; independent changelog and change classification approved.
- Source commit and exact pack bytes identified; no leaked secrets or server-only assets.
- Typecheck/lint/behavior/browser/accessibility/security gates passed where applicable.
- Exports/types/side-effects validated using the packed package.
- Dependency ranges compatible with existing published versions.
- Registry distribution and dist-tags verified after publish.
- No other packages were unintentionally published.

## 8. What is deliberately NOT configured yet

There are no actual package manifests, build scripts, npm credentials, Trusted Publishing associations, or release GitHub Actions in the repository today. Only documentation and a policy configuration file exist. They become operational during bootstrap, and must be tested before use.

## Verified pre-release gates (P1 hardening)

The independent [packed consumer and browser audit](../../tests/release/README.md) covers tarball exports, actual outside-workspace installation, TypeScript import/typecheck, same-runner deterministic build hashes, CSP, automated axe WCAG checks and a bounded Chromium GC regression. The verification script's strict `--enforce-release` mode rejects release blockers; normal PR CI allows the development stage's known placeholder versions while recording them as explicit blockers. **The repository currently has no approved root LICENSE and packages still use `0.0.0`, so publication is prohibited.** Verify npm scope control, trusted publishing association and release approval separately before enabling `npm publish`.
