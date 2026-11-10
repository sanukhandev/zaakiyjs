# Production hardening — baseline and execution gates

Status: **M0 initiated; implementation and full certification NOT complete**.
Baseline main commit: `f19b9f6a466de7f5b03dd085925c8d9092a87f85`.
Integration branch: `feat/production-hardening-integration`.
No npm publishing, repository settings changes, or automatic merge authorized.

## Baseline inventory

25 existing package directories: ads, analytics, async, cli, compat, compiler, consent, core, dom, forms, http, motion, proxy, router, seo, signals, ssr, store, styles, templates, ui-primitives, ui, vite-plugin, plus **two additional entries?**

Correction: enumerate package paths programmatically and verify count before certification. The GitHub directory listing reviewed at baseline contains 23 package directories (ads, analytics, async, cli, compat, compiler, consent, core, dom, forms, http, motion, proxy, router, seo, signals, ssr, store, styles, templates, ui-primitives, ui, vite-plugin). Prior conversational references to 25 must not be treated as verified.

## M0 verification tasks

- Record package manifests, exports, type declarations, build/test scripts, and dependency DAG.
- Capture baseline lint, typecheck, build, unit, browser, security and package-archive results with exact command, environment, timestamp and exit status. **Not yet executed**.
- Inventory issues #24, #37, #48, #59 and reproduce relevant defects before fixes.
- Record existing browser and consumer application fixtures; never equate prior CI success with fresh local execution.
- Generate package-specific findings with severity, owner, reproduction, affected downstream consumers and acceptance test.

## Mandatory invariant gates

1. Preserve all existing supported public exports, type signatures, behavior and documented ABI semantics; additions default opt-in.
2. Maintain IR v1 and native DOM ABI compatibility. If impossible, stop for versioned-contract and migration approval.
3. Run existing and newly added tests after each milestone, including downstream consumers and Chromium/Firefox/WebKit.
4. Never delete tests, skip failing checks, weaken assertions or security/privacy controls to obtain green CI.
5. For every fix, demonstrate failing reproduction before change and passing regression test after.
6. Verify cancellation, cleanup, focus/input identity, accessibility, browser/server isolation and build reproducibility.
7. Preserve current CSR default until compiler SSR output and hydration adoption are independently certified.
8. Compare measured performance and memory against pinned baseline, documenting methodology and tolerances.
9. Keep documentation synchronized with actual source exports; do not claim unpublished packages are npm releases.
10. Do not merge or publish without explicit user approval.

## Milestones

- M0: baseline, dependency graph, defect inventory, and audit evidence.
- M1: signals/core/dom ownership and scheduler stabilization.
- M2: compiler/TSX, native refs, slots, dynamic bindings and ABI integration.
- M3: application packages, generated starters, networking, UI, routing and browser targets.
- M4: trusted SSR compilation, hydration, dynamic SEO and privacy integration.
- M5: security, consent, accessibility and multi-browser acceptance.
- M6: reproducible builds, memory, performance, packaging and external consumer certification.
- M7: docs reconciliation, full final-head CI, manual PR review and merge decision.

## Current known findings

- Compiler documents unsupported JSX children, spreads, refs and dynamic styles; see issue #37.
- Compiler native `htmlFor` lowering is tracked in issue #48.
- SSR package explicitly lacks compiler-generated server TSX and DOM hydration adoption; issue #59.
- Release authorization, license, SemVer, namespace and provenance remain tracked in issue #24.
- `docs/site/planned-packages.md` still describes Analytics as pending even though #56 merged.
- Package READMEs contain stale M0/PR status descriptions.

These are initial repository-documentation findings, **not** proof that a complete source/security/performance audit has been run.

## Merge-ready definition

All in-scope P0/P1 defects resolved; unchanged supported contracts or approved migrations; baseline and downstream regressions green; real-browser, security, accessibility, SSR/hydration and clean consumer evidence recorded; no unexplained performance regression; final PR mergeable with required CI passing; explicit human approval.
