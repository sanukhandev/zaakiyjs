# PR-driven independent npm releases

Status: proposed in the release-pipeline PR. No npm package version, registry setting, tag, credential, or publication is changed by installing the pipeline.

## 1. PR classification (ZaakiyJS-specific)

| PR title | Version intent | Example from stable 1.2.3 |
| --- | --- | --- |
| `feat(scope): description` or `feat!: description` | major | 2.0.0 |
| `change(scope): description` | minor | 1.3.0 |
| `fix(scope): description` | patch | 1.2.4 |
| `docs:`, `test:`, `chore:`, `ci:`, `build:`, `perf:`, `refactor:` | none, only for non-publishable-file changes | unchanged |
| `release: prepare ...` | generated metadata only | manifest-defined |

This intentionally differs from Conventional Commits (where feat usually means minor). Scope is descriptive; the actual changed files determine the affected packages. A package implementation or manifest change must use feat/change/fix; a breaking fix must be classified as feat. Tests, package README/license/docs and test-only files do not cause releases. New/deleted packages and other workspace dependency protocols need a reviewed extension of this policy. Root-level tooling changes do not automatically publish all packages; identify package effects in the relevant package PR.

`Release Version Policy` runs for every PR, including title/label edits. It validates classification, prevents ordinary PRs from changing versions or the release manifest, and provides a JSON preview. The optional single label `release-channel:alpha`, `release-channel:beta`, `release-channel:gamma`, `release-channel:rc`, or `release-channel:stable` requests a channel; create these labels in GitHub if desired. Conflicting channel labels in merged PRs block preparation. Until the initial bootstrap, previews report bump intent rather than claiming a release version.

## 2. Release train

First release is explicitly selected by the maintainer, default `0.1.0-beta.0`. Alpha is also supported. All subsequent versions are independent; unrelated packages do not receive bumps. Each package tracks its last stable version and active prerelease target. Multiple merged PRs for a package take the highest severity once, not an accumulated bump per PR. A subsequent fix within an active prerelease advances its numeric counter; an intent requiring a larger target increases the core version and resets the counter. For example `0.1.0-beta.0` -> `0.1.0-beta.1` for a fix and -> `1.0.0-beta.0` for a feat.

| Channel | Example | npm dist-tag |
| --- | --- | --- |
| Alpha | 0.1.0-alpha.0 | alpha |
| Beta | 0.1.0-beta.0 | beta |
| Gamma (optional ZaakiyJS late-beta phase) | 0.1.0-gamma.0 | gamma |
| Release candidate | 0.1.0-rc.0 | rc |
| Stable | 0.1.0 | latest |

No automatic stable promotion. Explicit forward promotion retains the target core version and resets the new channel counter. The maintainer may skip optional phases. An active train must be promoted rather than switching backward; new prerelease trains may start after a stable release. Promotion requires no outstanding release-bearing PRs. Stable packages cannot depend on prerelease packages. Internal `workspace:^` ranges are resolved by pnpm packing; dependents receive a patch if the new dependency falls outside the previous packed caret range. Verify compiler-emitted imports, optional integrations and protocol compatibility in UAT; semantic compatibility is not established by a version number alone.

## 3. Generate a release PR (no registry writes)

1. Merge the pipeline PR after all required checks pass. Enable GitHub Actions to create PRs in repository Actions settings if the organization allows it; otherwise use the generated patch artifact with an owner-created branch/PR.
2. Open Actions -> **Prepare npm Release PR** -> Run workflow on main. Select bootstrap/beta for the first candidate, changes for merged implementation PRs, or promote for advancing a prerelease.
3. The workflow reads exact first-parent main history since the prior release source SHA and identifies the unique merged PR associated with each commit via GitHub API. Direct pushes, ambiguous association, incompatible classifications, and conflicting channel labels fail closed. Use merge or squash commits, not rebase merges for release-bearing PRs. The workflow never consumes unmerged branch changes.
4. It automatically computes versions, dependency closure, dependency-first order, independent changelogs and repository metadata, writes `.release/manifest.json`, and uploads the candidate patch. It can open a separate generated release PR; it never writes directly to main. A release PR must be regenerated if main moves.
5. Review the generated PR, confirm normal CI and the Release Version Policy check have actually run and passed, then merge. PRs created with the Actions token may require an owner to trigger normal PR checks depending on repository permissions. Do not bypass this requirement.

The manifest stores source SHA, selected versions, stable baselines, channel, merged PR evidence and dependency-first order. The first beta PR is not generated as part of the pipeline implementation PR. Do not merge another version plan before reconciling the previous planned release; unpublished required dependency versions block staging. A version already published must never be reused with changed bytes.

## 4. Secure npm staging

Configure repository environment **npm-production** restricted to main with required reviewers (where supported). Leave repository Actions variable `NPM_PUBLISH_ENABLED` unset or false until the owner has verified scope, access, UAT, manual accessibility, browser support and the first-publication process. Configure package-specific npm Trusted Publishers for repository sanukhandev/zaakiyjs, workflow `npm-publish.yml`, environment npm-production, stage-only permissions. No token is stored or passed by this pipeline. npm OIDC requires existing package registration; for first publication, use a separately authorized authenticated bootstrap of the certified archives (npm staged publishing creates a public placeholder for new names), then configure per-package OIDC. Do not supply credentials to ChatGPT or commit them.

Run **npm Release Certification and Staging** on main with the exact merged release SHA. Default mode dry-run performs no registry writes. It verifies the generated release PR's checked tree, its release policy run, successful exact-main CI (including quality, release hardening, benchmark, CLI and M1 browser matrix), then reruns quality, production dependency audit and strict pack verification. It retains the actual tested tarballs with SHA-256 and SHA-512 integrity in a workflow artifact; no rebuild occurs in the credentialed staging job.

Only with mode stage, exact confirmation STAGE APPROVED RELEASE, NPM_PUBLISH_ENABLED=true and environment approval does the OIDC job obtain a write identity. It preflights all selected versions and unselected internal dependency versions and stages the selected exact tarballs in dependency order using the explicit dist-tag. A staging operation is a registry mutation; human npm 2FA approval is still required. Do not approve dependents before their dependencies. No automated retries or unpublish; reconcile any partially staged/published batch manually. A staged package is not yet released.

After owner approval, run **Verify Published npm Release** with the release SHA and successful certification workflow run ID. It retrieves the certified artifact and verifies every selected version's registry integrity and tag. Perform fresh registry-only installations (no workspace/file overrides), CLI scaffold, build and application UAT before announcing the release. Verification does not create Git tags; add package-specific tags only after the registry and consumer gates pass.

## 5. Implementation decisions and limits

This proposal uses the existing locked node-semver library (7.8.6) for SemVer operations and a repository-specific release policy/ledger, rather than introducing a second version writer. It supersedes the earlier Changesets CLI bootstrap proposal because the custom PR taxonomy and staged channel policy need a single auditable source of truth. The existing independent-mode Changesets config remains as a compatibility/policy marker; do not run Changesets version in parallel. The owner must review this policy change before merging. No runtime package receives this dev dependency. Initial registry authorization, protected environment settings, live npm staging, external registry-only installation and actual end-to-end release preparation remain to be validated. See npm documentation: https://docs.npmjs.com/trusted-publishers/ and https://docs.npmjs.com/staged-publishing/.

## 6. Tests

```sh
pnpm install --frozen-lockfile
node --test scripts/release/version-policy.test.mjs scripts/release/npm-stage.test.mjs
pnpm ci
```

PR tests exercise custom title classification, independent bump precedence, 0.x incompatibility, prerelease progression, stable promotion, dependency cycles/ranges and artifact digest, tag and duplicate validation. Existing release-hardening tests remain mandatory. Publication stays disabled; no live registry mutation is a unit test.
