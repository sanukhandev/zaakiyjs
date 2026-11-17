# Completion plan — existing partial packages and performance certification

**Date:** 2026-11-17  
**Baseline:** `main@f19b9f6a466de7f5b03dd085925c8d9092a87f85`  
**Integration parent:** PR #61, `feat/production-hardening-integration@427df7cedfd8a1a9401852ba9dc82fe7095883fb` (draft)  
**Scope:** Compiler, Vite Plugin, CLI, Compat, UI, Motion, SSR plus the shared DOM/Router integration surfaces. Excludes planned packages without source directories. The Image package on PR #61 is an additional, optional workstream.

## Definition of complete

"Implemented" is not equivalent to "production-certified." A package can be declared complete for the agreed v0.1 public scope only when:

1. Each supported API has an explicit versioned contract, public exports and type declarations; unsupported syntax is diagnosed and documented.
2. Real compiled TSX / generated native DOM behavior matches the contract in Chromium, Firefox and WebKit.
3. Ownership, cleanup, cancellation, focus/selection, security boundaries and accessibility invariants pass regression tests.
4. The package and dependent package tests, frozen build, external packed consumer and independent relevant browser/Node workflows pass on the same final commit.
5. No unreviewed breaking IR/DOM ABI or public API changes; changeset, migration notes and size/performance comparison included.
6. Final source commits are reviewed before merge. npm publication requires a separate release authorization.

Do **not** widen the intended v0.1 scope silently to "support all JavaScript/React/Next.js features". Anything deliberately excluded must fail closed with useful diagnostics.

## Dependency order and implementation gates

| Gate | Packages and deliverable | Functional acceptance | Comparative benchmark | Blockers |
| --- | --- | --- | --- | --- |
| G0 baseline | All 23 + Image on PR #61: export/dependency inventory; fix `main` Analytics docs drift; pin reference fixtures/hashes | Frozen install; lint, build, typecheck, full tests; 3-browser fixtures; compare source ABI | Record per-package gz/br, baseline app costs and raw run IDs | No new API changes until snapshot recorded |
| G1 compiler composition | Compiler + Core + DOM: finalize reviewed JSX child/named-slot/ref/fragment contract; safe finite class/style/attribute binding; explicit diagnostics for unsupported spreads/URLs | Golden fixtures, purity/side-effect order, typed props, stable identity, owner disposal, malicious input/security, browser focus/selection | 100/1k/10k keyed operations, p50/p95/p99, mutation counts, retainable nodes, 100-cycle teardown | Version IR on semantic changes; no invisible JSX fallback |
| G2 SSR/hydration | Compiler + SSR + DOM + Router: finish opt-in region hydration plan, safe state transfer, nested/keyed/conditional adoption, mismatch recovery, navigation and streaming integration | Trusted emitted-byte verification; SSR markup equality; 404/redirect/private-cache isolation; escape and CSP; event restoration; rollback on mismatch; abort/teardown | Same-workload React/Vue/Angular/Zaakiy 100/1k/10k rows across three browsers; 50 measurements each; hydration vs startup separated, HTML/JS/CSS gzip/br and retained owner evidence | Arbitrary user code execution at request time remains forbidden |
| G3 compatible builds | Compat + Compiler + Styles + Vite Plugin: compose AST/API/CSS target analysis, approved transformations/shims and deterministic compat manifest in production graph | off/auto/strict behavior; unsupported features fail under strict; correct byte accounting; no unreviewed global patches; real declared browsers | Build, gzip/br and behavioral parity for each profile; transform pass time and shim bytes | Unsupported API cannot be claimed polyfilled |
| G4 lifecycle UI | UI + UI Primitives + Motion + DOM: support component composition and owner-scoped exit/portal/keyed transitions without losing focus/ARIA | Dialog/listbox/menu/tabs, nested portals, keyboard/focus, reduced motion, pre-removal cancellation, reentry and disposal | 100/1k interactions, first input delay proxies and INP where measurable; frame p95 and heap retention in three engines | Changes to region pre-removal ABI require explicit review |
| G5 developer tooling | Vite Plugin + CLI + Templates: safe state-preserving HMR protocol or formally freeze full reload as the v0.1 contract; wire production SSR/compat configuration; implement agreed CLI generators and selected commands | Generated real app typecheck/build/browser behavior; HMR owners/listeners disposed exactly once; failure rollback; no duplicate event listeners; no implicit installation | 1/8/24 module clean/warm Vite builds; 20 samples, p50/p95/p99, JS/CSS exact hashes; CLI plan vs full scaffold separately | No declaration of HMR support without state and cleanup tests |
| G6 integrated application | All implemented packages: representative auth-free and authenticated sample(s), data lifecycle, forms+router+store+async+HTTP, SSR/SEO and consent-aware optional scripts | E2E non-mocked browser + Node transport where possible; privacy, redirects, CSRF/auth host boundary and cleanup | 300/700 item CRUD, real 100/300/700-field validation, 1000 navigations, browser memory slope | No real production secrets in fixtures |
| G7 release certification | All implemented packages: docs, API/ABI, license, dependency audit, Changesets, release notes and clean consumer installations | Final-commit Quality, 3-browser, release, a11y, CSP, security and provenance checks; signed reviewer acceptance | Publish baseline/candidate paired report and raw logs; disclose hardware and noise | Owner approval required for npm scope, license, SemVer and publication |

## Existing PR #61 evidence to retain, not rerun as new claims

- H4 restricted framework/browser/scale comparator: 36/36 cases and 100-cycle owner cleanup passed at recorded final head. Limitations still include general TSX composition, other workloads, peer approval and full production certification.
- E1 Vite diagnostics session optimization: previously measured ~80.8% and ~81.8% lower 24-module p50 vs pinned previous implementation with identical output hashes.
- E3 sparse/equal keyed paths, B2 Proxy and B4 UI roving focus have workload-specific gains; rejected Core/Signals experiments must stay reverted.
- E5 300/700-row integrated CRUD Node/jsdom performance and E9 build-time Image optimization evidence are diagnostic, not real-user metrics.
- Original `main` `Quality` failed 40 Analytics documentation export checks; PR #61 Quality passed. Do not merge documentation drift back.

## Benchmark contract

- **Correctness first:** In every timed run, assert output DOM state, key ordering and native identity, focus/selection, event counts, secret rejection and owner cleanup. A faster incorrect operation is a failure.
- **Reference pinning:** Maintain frozen `main` and prechange PR #61 candidate snapshots, source hashes, Node/pnpm/Vite/compiler versions, exact browser binary versions and lockfile hashes. Compare identical app semantics with React/Vue/Angular only where equivalent.
- **Timing:** Per browser and workload, 10 warmups and 50 measured operations for the production hydration comparator; for microbenchmarks, at least 3 warmups and 20 measured samples with raw distributions, p50, p95, p99. Repeat meaningful gains on at least two independent CI runs.
- **Budgets:** Fail on correctness/security/leak regressions, output non-determinism, unauthorized bundle imports, target/browser errors and declared hard resource limits. For performance, establish workload-specific p95 budgets from frozen CI evidence; >10% p95 regression must be reviewed even if p50 improves. Do not apply one global microbenchmark speed target to all packages.
- **Memory:** Explicit owner/listener counts at zero after dispose; browser heap and weak-reference evidence across 100/1000 cycles, with forced GC only where supported and no false cross-browser byte comparability claims.
- **Artifacts:** Immutable JSON raw samples, SHA-256 JS/CSS/HTML hashes, gzip/brotli bytes, browser versions, run URLs, setup and measured steps. Include sample counts and whether startup/network were measured.
- **Security/a11y:** CSP/Trusted Types and XSS/SSRF fixtures as applicable; axe plus manual keyboard/screen-reader spot checks for representative UI. Benchmarking does not replace audits.
- **No sweeping superiority claims:** Compare only the declared fixture, browser, hardware and sample period.

## This branch's scoped vertical slice (G5 partial)

- [x] Implement native one-root `zaakiy g page` and `zaakiy g layout`, safely typed and consciously not promising JSX children/slots.
- [x] Add CLI generator/idempotency/path-traversal regression tests.
- [x] Add generated-app TypeScript/Vite compilation in the maintained acceptance workflow.
- [x] Add isolated 20-sample, 250-iteration plan microbenchmark with per-run SHA-256 determinism and raw p50/p95/p99 output.
- [ ] Verify exact branch-head CI and benchmark artifact; no speedup claimed before actual run.
- [x] Implement `store`, `resource`, `task`, `interceptor`, and server-only `proxy` generator templates with public-package APIs.
- [x] Add generator unit tests and generated-application compiler/Node-target checks for these five generators.
- [x] Extend deterministic SHA-256 plan benchmark from page/layout to seven new generator kinds.
- [ ] Benchmark and final-head CI approval for the expanded generator set; CLI `analyze`, `migrate`, and `seo` commands remain deferred behind their own reviewed contracts.
- [ ] Full state-preserving HMR, compatibility graph transforms and general SSR hydration are not included in this CLI slice.

**Review rule:** Keep PR #61 open/draft. This work must be reviewed in a stacked PR targeting PR #61, not merged directly to `main`. Do not mark G1–G7 complete from this slice.
