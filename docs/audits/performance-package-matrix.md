# 23-package performance and benchmarking assessment

Status: **implementation evidence, not full production certification**.
Candidate: `perf/production-benchmark-optimization` stacked on PR #61.
Comparators: React 19.2.4, pinned original main `f19b9f6`, frozen hardening head `04f453c1`, candidate.

## Acceptance principle

A package is optimized only when a representative, semantically correct benchmark identifies a bottleneck; the change improves it without regressions in public API, memory, security, accessibility, and browser semantics. Small/noisy synthetic numbers are not an optimization mandate. No package is certified by emitted file-size inventory alone.

## Per-package evidence

| Package | Available measurement | Current status | Additional acceptance before full certification |
| --- | --- | --- | --- |
| @zaakiyjs/signals | 1,000-fanout, 5,000-update Node microbench, real browser reactive updates | Comparative baseline | Dynamic dependency churn, scheduler fairness, failure cycles, memory |
| @zaakiyjs/core | 2,000-child owner allocation/disposal with verified cleanup | Comparative baseline | Deep lifecycle, error unwind, sustained retention |
| @zaakiyjs/dom | 9 equivalent React and frozen-head browser operations, sparse-move unit/browser tests, 100–10,000-row scaling | **Sparse reconciliation optimized** | Complex fragments, sustained memory, large-realistic UIs |
| @zaakiyjs/compiler | Supported TSX compile timing, stable SHA-256 output | Comparative baseline | Large component trees, cold/warm builds, maps and IR v2 |
| @zaakiyjs/styles | 4,000 token CSS compilation, stable output SHA | Comparative baseline | Thousands of distinct utilities, themes, responsive variants |
| @zaakiyjs/vite-plugin | Integrated production generated-app build in CI | Integration-checked, not isolated timing-certified | Cold/warm HMR, invalidation, CSS extraction, source maps |
| @zaakiyjs/compat | Three browser engines and compatibility smoke | Correctness-checked | Manifest/transform byte attribution for target matrices |
| @zaakiyjs/cli | Generated-app acceptance and production builds | Correctness-checked | Scaffold/install and repeated build timing, templates |
| @zaakiyjs/store | 1,000 scoped actions per sample with immutable-state assertions | Comparative baseline | Large state graphs, selectors, zero unrelated subscriber executions |
| @zaakiyjs/router | 514-route broad and 42-route deep matching microbench, browser route acceptance | **Nested match path simplified/secured** | Full navigation, guards, async loaders and code splitting |
| @zaakiyjs/forms | Existing unit and generated-app browser integration | Correctness-checked | Large forms, async validation/input responsiveness |
| @zaakiyjs/async | Existing unit and browser integrations | Correctness-checked | Resource scheduling, retries, cancellation and memory |
| @zaakiyjs/http | Existing workspace tests and generated-app consumer | Correctness-checked | Fetch transport/interceptor overhead with mock server |
| @zaakiyjs/proxy | Existing workspace unit/release integration | Correctness-checked | Server concurrency, streaming, bounded buffers and SSRF threat model |
| @zaakiyjs/ui-primitives | Existing package/browser tests | Correctness-checked | Roving focus, overlays, portal event cost and leak stress |
| @zaakiyjs/ui | Existing package/browser tests | Correctness-checked | Component interaction/DOM mutation comparisons |
| @zaakiyjs/templates | Generated-app browser matrix | Correctness-checked | Dashboard/CRUD startup, load/warm transitions |
| @zaakiyjs/motion | Three-engine native browser matrix | Correctness-checked | Frame budget, layout reads/writes, reduced-motion regressions |
| @zaakiyjs/ssr | Existing static/data SSR checks and release tests | Supported subset checked | Full live TSX SSR and true DOM-adopting hydration **not implemented** (#59) |
| @zaakiyjs/seo | Existing workspace/release correctness | Correctness-checked | Dynamic route metadata render latency and caching |
| @zaakiyjs/analytics | Three-browser privacy CI | Correctness-checked | Consent-gated event batching and main-thread overhead |
| @zaakiyjs/ads | Three-browser consent/CLS CI | Correctness-checked | Deferred loading under realistic ad-network conditions |
| @zaakiyjs/consent | Workspace, ads and analytics privacy tests | Correctness-checked | Repeated consent state transitions and revocation cost |

## Production comparison methodology

- Four-way baseline in Chromium, Firefox, and WebKit with verified identical DOM state and native row identity on each sample. The React fixture uses a legitimate memoized row component.
- Each benchmark runs from production Vite preview, not a development server.
- Snapshot includes raw samples, p50/p95/p99, browser version and host; all nine workload results are mandatory for the CI regression gate.
- Scaling tests include explicit root disposal and assert no DOM rows remain.
- Package-footprint inventory reports individual package JS/CSS gz/brotli but does **not** represent the actual application bundle or browser runtime.
- Source builds are pinned, tests are not removed/disabled, and rejected experiments remain excluded.

## Findings and decisions

- Prepending and rotating previously moved almost the entire keyed list. Longest-increasing-subsequence reconciliation prevents unrelated DOM moves, with substantial measured improvements across browsers.
- Full reverse batches still outperform React in the observed WebKit/Chromium fixture. Firefox remains behind older main on reversal, although currently comparable to or faster than the frozen hardening reference and React; track separately instead of weakening release claims.
- The `Range.extractContents` alternate batch implementation was rejected after an observed WebKit regression above 300ms at 1,000 rows; see GitHub Actions run `42980306968`.
- Router repeated a tokenization pass for each ancestor on every match. New matching logic accumulates already-validated local param names and safely handles reserved property names. Its independent broad/deep microbench must determine whether this meaningfully improves runtime.

## Certification boundaries

The performance work is a **focused vertical slice** with 23-package footprint and contract coverage. It does not prove real-user Core Web Vitals, universal dominance over React, full production memory leak freedom, or full-package performance certification. The independent hardening milestones M0–M7 and release blockers #24/#37/#59 remain in force. No npm publication or protected-branch merge should follow without signoff.
