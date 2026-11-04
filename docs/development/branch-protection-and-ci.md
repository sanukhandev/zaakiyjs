# Main Branch Protection and Continuous Integration

> **Status:** repository CI and the desired ruleset are proposed in a PR. A checked-in JSON policy does **not** protect a GitHub branch. An authorized repository administrator must create/enable the ruleset in GitHub and verify its enforcement. The connected GitHub app does not have the required administration API permission.

## Intended main branch policy

- PRs required before merging to `main`; reject direct updates, branch deletion and force pushes.
- Block merge until **all three required status checks** pass: `quality / lint`, `quality / typecheck`, and `quality / build`.
- Require the PR to be up to date with the base branch (strict checks), and require review conversations to be resolved.
- No bypass actors configured. Initial minimum approvals is **0**, intentionally, since a solo maintainer cannot approve their own PR; increase to 1+ once an independent reviewer is available.
- CI runs on `pull_request`, `push` to `main`, and `merge_group`. There is no path filter, so docs-only PRs receive the same statuses.

The source-of-truth candidate ruleset is [`.github/rulesets/protect-main.json`](../../.github/rulesets/protect-main.json). The workflow is [`.github/workflows/quality.yml`](../../.github/workflows/quality.yml).

## Apply the repository ruleset — requires admin authorization

**After this PR is merged and a successful Quality workflow is visible:**

Using GitHub CLI with a credential authorized for **Administration: write** on the repository:

```bash
# Review the ruleset file before running. This creates a new ruleset once.
gh api --method POST repos/sanukhandev/zaakiyjs/rulesets \\
  --input .github/rulesets/protect-main.json

# Confirm that the ruleset exists and is active.
gh api repos/sanukhandev/zaakiyjs/rulesets
```

Alternatively, navigate to **Repository Settings → Rules → Rulesets → New branch ruleset**, target `main`, choose **Active** and configure the rules listed above. Required checks must match the workflow's displayed job names exactly, after GitHub has recorded at least one run.

**Important:** Do not repeatedly POST the same JSON; GitHub will create duplicates. If a ruleset already exists, update it rather than creating another.

## CI details

- Node.js 22 and pnpm 10.20.0 are pinned at the major/minor toolchain boundary.
- `pnpm lint`: checks workspace package scripts, runs ESLint and recursively runs per-workspace linters.
- `pnpm typecheck`: strictly typechecks repository bootstrap tooling and runs every package's typecheck.
- `pnpm build`: compiles repository bootstrap tooling and builds workspace packages in dependency order.
- New `packages/*`, `apps/*`, and `examples/*` workspaces must declare working `lint`, `typecheck`, `build` scripts. Never use no-op commands to claim green CI.
- This repo now contains **seven M0 contract-only packages**. Passing checks validates ESM/type contracts and workspace wiring only, not runtime/compiler functionality.

## Reproducibility bootstrap exception

M0 commits a generated pnpm 10.20.0 lockfile. Each required CI job runs `pnpm install --frozen-lockfile`; an absent or stale lockfile is a hard failure. The temporary lockfile-generation workflow removed itself and is **not** part of the ongoing CI pipeline. The build job also runs M0 package export and cross-package contract tests. This validates dependency locking, not functional framework implementation.

## Verify after enabling protection

1. Open a test PR to `main`; verify the three separate Quality checks run and pass.
2. Introduce an intentional lint failure and confirm `quality / lint` fails and GitHub blocks merge.
3. Introduce a TypeScript type error and confirm `quality / typecheck` blocks merge.
4. Introduce a compilation error and confirm `quality / build` blocks merge.
5. Confirm direct pushes, force-pushes and deletion of `main` are rejected for non-bypass users.

Do not report protection as **active** until GitHub lists the enforced ruleset and blocking behavior is tested.
