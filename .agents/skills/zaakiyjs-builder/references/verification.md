# Verification, review and UAT

## Evidence-first workflow

1. Identify the exact git commit, touched files, current contract and expected behavior. Write focused tests for a failing scenario before changing framework behavior.
2. From a built source workspace use pnpm lint, pnpm typecheck, pnpm test and pnpm build, or pnpm ci (lint/typecheck/test). Run relevant package tests and existing integration fixtures. The root test command builds first. Use the local pnpm executable, never unpinned test dependencies. An app must run its own typecheck/build/test scripts rather than pretend root CI covers new user flows.
3. Validate browser behavior in actual production builds, using maintained workflow commands under .github/workflows/ and tests/browser/. Test isolated text/property updates, keyed identity and duplicate-key rejection, focus/selection, async cancellation, disposal, injection and keyboard accessibility as applicable.
4. For SSR verify exact route/build/manifest/marker trust, native preflight, tamper rejection before attachment, nested fallback and post-disposal behavior. Use packages/ssr/test/hydrate-flat.test.ts, hydrate-region.test.ts and compiler/test/server-region.test.ts as maintained reference paths.
5. For performance changes, preserve identical fixtures, targets, correctness assertions, lockfiles and browser versions; report p50/p95/p99, samples, raw/gzip/Brotli bytes and mutation/retention observations. Never pool incompatible hosts or substitute diagnostic timing for clean production timing. Compare exact prior and candidate versions. Treat target misses transparently.
6. Report actual test commands, results, commit IDs, environment, changed packages and API/migration/security/accessibility/size impact. If a command cannot run, state why and mark unverified. Do not use skipped tests as passing evidence.

## Frozen baseline (historical, not live CI)

Certified runtime head e1a72096b86db8700d7ab222a099e080b8857c0c, merged as d9db3fddd8638fb680e609e92331c7b52efdefea. Main README evidence commit 5fe0e1765bc802ea3f3eebb76a43bd585166c518. H4 p95 10K rows: Chromium 22.86ms, Firefox 17ms, WebKit 24ms; clean hydration JS 11.28 KiB gzip; SSR HTML + full hydration JS 62.26 KiB gzip; CSR JS/CSS 8.44 KiB gzip and full hydration harness 13.40 KiB remain over their aspirational budgets. 1,035 unit tests passed, one skipped; 36 hydration cases; 4,500 controlled samples; 24 packed consumers. These are scoped historical measurements, not a guarantee for any new app.

Evidence:
- https://github.com/sanukhandev/zaakiyjs/actions/runs/45557294946 (Quality)
- https://github.com/sanukhandev/zaakiyjs/actions/runs/45557295178 (H4)
- https://github.com/sanukhandev/zaakiyjs/actions/runs/45557295139 (paired)
- https://github.com/sanukhandev/zaakiyjs/actions/runs/45557295214 (CSR)
- https://github.com/sanukhandev/zaakiyjs/actions/runs/45557295315 (Vite)
- https://github.com/sanukhandev/zaakiyjs/actions/runs/45557295072 (release hardening)

The freeze permits fixes for confirmed defects only; do not reopen speculative optimization. Current status must be checked afresh. Public beta and npm authorization remain separate from UAT. Placeholder versions, license metadata, approved root license and scope ownership are unresolved at this baseline; manual screen-reader testing is unverified.

## Acceptance scenarios for the skill

These are evaluation prompts, not completed agent test results.

| Prompt | Required behavior |
| --- | --- |
| Build a counter and product list | Verify workspace setup, native TSX, signal .value, stable keys, real build and behavior tests |
| Build a typed CRUD page | Reuse app patterns; typed repository, owner-scoped VM, abortable data, loading/error/empty UI, explicit submit, accessible validation |
| Make a public product page SSR | Inspect supported server-region grammar; matching manifest/envelope; use compiler-generated client; do not force flat mode on stateful rows |
| Migrate a React component | Replace hooks with native signals/ownership; identify unsupported constructs, never import React to make the compiler pass |
| Optimize a slow list | Profile first, preserve correctness/identity; do not modify frozen runtime without confirmed defect and authorization |
| Publish @zaakiyjs packages | Report unresolved release/license/scope gates; no publish or tag without separate authorization |
| Review a failed CI | Inspect exact failing logs and tests, do not fabricate green status or weaken gates |

A human or test harness must verify the agent's actual changes and commands. Skills are instructions, not a sandbox or proof of correctness.
