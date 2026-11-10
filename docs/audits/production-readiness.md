# Production hardening — baseline and execution gates

Status: **M0 initiated; implementation and full certification NOT complete**.
Baseline main commit: `f19b9f6a466de7f5b03dd085925c8d9092a87f85`.
Integration branch: `feat/production-hardening-integration`.
No npm publishing, repository settings changes, or automatic merge authorized.

## Baseline inventory

23 package directories were verified in the GitHub baseline listing: ads, analytics, async, cli, compat, compiler, consent, core, dom, forms, http, motion, proxy, router, seo, signals, ssr, store, styles, templates, ui-primitives, ui, vite-plugin. This is a directory inventory, not yet a complete public-export or dependency audit.

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
- Analytics site documentation was stale after PR #56 merged; this branch updates the source status and public API index.
- Package READMEs contain stale M0/PR status descriptions.

These are initial repository-documentation findings, **not** proof that a complete source/security/performance audit has been run.

## Merge-ready definition

All in-scope P0/P1 defects resolved; unchanged supported contracts or approved migrations; baseline and downstream regressions green; real-browser, security, accessibility, SSR/hydration and clean consumer evidence recorded; no unexplained performance regression; final PR mergeable with required CI passing; explicit human approval.

## Integration implementation ledger (November 10, 2026)

The PR has production code changes; earlier statements that it contains only documentation are superseded. The branch adds native `htmlFor` lowering with 3-browser label association acceptance, connected native JSX refs (opt-in, preserving eager `bindRef`), and SSR cache rejection of responses with undeclared HTTP `Vary` dimensions. It also adds workspace graph/integrity and post-build export/CLI/type declaration validation. Each new head requires its own Quality and browser evidence.

**Verified earlier head:** `46a5abeb244862ed71d245a862b9e476363378d5` passed eight workflows including Quality, M1 browser, Release Hardening, Templates, Router, CLI, Motion and Analytics Privacy. This does not certify later commits or close milestone gates.

**Remaining architectural blockers:** #37 component children/slots, safe dynamic class/style variants and exit-aware regions; #59 compiler-generated SSR and real hydration; #24 independent release authorization. The automated audits do not prove manual screen-reader coverage or legal/npm credentials. No milestone is marked fully accepted by this ledger.

### Finite CSS variants and ref lifecycle (hardening follow-up)

- Compiled JSX supports owner-scoped finite literal-branch class variants and non-URL reactive attributes. Every dynamic CSS candidate is source-spanned and verified by the Vite stylesheet bridge. Arbitrary class names, escaped/unverifiable source tokens, inline style and dynamic URLs fail closed.
- The DOM tests now cover disconnected mounts, pending ref cancellation on owner disposal and exception-triggered mount rollback, in addition to connected/ref-reorder browser coverage.
- Earlier hardening CI exposed and led to correction of unverifiable style token offsets and a legacy static `class={'...'}` manifest compatibility regression. These are *not* accepted until final-head CI passes.


## M4 SSR trust-boundary increment

- Build-side SHA-256 artifact manifests are generated from exact emitted module bytes; a separate verification helper rejects modified, missing or extra artifacts, and tests include malicious getter-backed registries.
- Browser-side hydration *probe only* now checks marker template digests as well as IDs/order/route/build, refusing to attest older ID-only comments.
- These additions do not solve issue #59's compiler-generated server output or DOM adoption. Never mark the M4 milestone complete on their account.


## Optional exit-aware region integration

An additive \`@zaakiyjs/dom/compiler\` helper retains exactly one native Element and its owner during a bounded cancellable exit, with re-entry reuse and mandatory cleanup on parent disposal. This isolates P2 Motion integration without changing frozen compiler DOM ABI v1 or the immediate-disposal behavior of generated \`<Show>\`/\`<For>\` regions. Full keyed/fragments/portal exit orchestration remains a separate issue #37 acceptance item.
