# ZaakiyJS performance optimization — execution ledger

Status: **B0/B1 active; not production certified; no PR/release authorized**.
Optimization branch: `perf/production-benchmark-optimization`, based on the immutable PR #61 head `04f453c18b31c7f900d77b037b0548f8888826f1`.

## Reproducible baselines and limits

Four independent production-built references should be reported: React 19.2.4, frozen ZaakiyJS main `f19b9f6a466de7f5b03dd085925c8d9092a87f85`, frozen hardening parent `04f453c18b31c7f900d77b037b0548f8888826f1`, and candidate. Pin build tools and browsers, record raw sample distributions, assert exact keyed state and retained node identity on each iteration, preserve current browser-engine-specific evidence.

The JS/CSS application transfer estimate is gzip/Brotli of production-built assets only. A second report inventories 23 individually compressed emitted package sizes for attribution; these are **not** equivalent to single-application bundle cost or the npm registry tarball.

## Reproduced issue: sparse keyed changes moved many unrelated rows

The former right-to-left placement algorithm staged new keys at the end, then could reposition every old range for a prepend. An L.I.S. (longest increasing subsequence) move planner now retains the maximal already-sorted run, limiting movement to new/out-of-order keys. Underlying components and owners are not recreated.

Before/after baseline-run evidence, GitHub Actions:
- Source run `42978055770` (pre-fix, expanded 9 operations); follow-up `42979636146` at commit `0c1fa765` (LIS).
- Chromium: prepend p50 **16.1 -> 0.5ms**; swap **4.2 -> 0.8ms**; rotate **4.2 -> 0.7ms**.
- Firefox: prepend **5.5 -> 1.0ms**; swap **11 -> 1ms**; rotate **11 -> 1ms**.
- WebKit: prepend **10 -> 1ms**; swap **21 -> 2ms**; rotate **20 -> 0ms** (0ms is an insufficient timer-resolution reading, not zero cost).
- These measurements compare a fixed frozen-main implementation to the candidate **within one CI run**, not independent noise-calibrated confidence intervals. React was also measured with equivalent input operations.
- Firefox full reverse remains behind frozen original main on several CI hosts. The latest completed 11-workflow run `42982857939` measured Firefox reverse **6ms main, 9ms hardening, 8ms optimized** at p50, while all nine browser workloads and stricter evidence gates passed. This does not establish a fully resolved main-baseline regression. An alternative high-churn batch extraction experiment has been measured and rejected: GitHub Actions run [42980306968](https://github.com/sanukhandev/zaakiyjs/actions/runs/42980306968) on experimental commit `cd16f58f` achieved Firefox full reversal ~9ms but regressed WebKit full reversal to ~361ms p50 (retained implementation ~10ms), failing the browser regression gate. The experimental implementation must **not** be merged; the original WebKit-safe batch algorithm stays.
- The 23-package size inventory has sizeable differences in Compiler, DOM and SSR relative to the old main commit because the broad PR #61 adds features. Attribute **incremental** optimization cost against frozen hardening head, not main alone.

## Tests and correctness invariants

- Prepend, append, swap, rotate, reverse, rename, conditional toggle and middle deletion/reinsertion use the same supported JSX/reactive feature subset.
- Check exact rendered data, key order, count and DOM identity for every retained row on every iteration. Detect errors or duplicate keys; fail rather than silently accepting incomplete measurements.
- DOM integration tests count sparse insertions, preserve focused input's selection and direction, preserve unrelated siblings, and assert owner cleanup counts.
- Current CI run `42979636146` passed the independent production browser benchmark; Quality, M1, CLI, Router, Templates, Motion, Compat, Ads, Analytics Privacy and Release Hardening passed at the same source commit.
- Future experiments must pass the entire latest-head CI matrix again.

## Remaining scope and release boundaries

B2–B6 still require evidence-driven work on compiler, styles, compatibility, Vite, 23 package consumers, real-world applications, sustained memory, 10k list scaling, and calibrated CI thresholds. Synthetic owners/signals/compiler measurements are useful diagnostic additions but do not establish full production-grade performance certification. The existing wider M0–M7 hardening blockers (including dynamic SSR/hydration and release authorization) remain independent gates.

Do not claim React/Vue/Angular universal superiority, a fully optimized 23-package runtime, complete production certification, or benchmark superiority based on a single CI host. Do not open a review PR until the requested implementation scope and supported validation are complete.

## Follow-up: route matching and extended package evidence

Commit `f2ba3342` passed 11 of 11 CI workflows including the expanded React benchmark and new eight-case failure-injection gate tests. A nested route match now reuses already validated local parameter segments and preserves safe, frozen inherited parameter snapshots. A 514-route microbenchmark initially showed 0.03266ms candidate versus 0.03147ms hardening p50, which is within noise and **not a proven broad-table speedup**. The subsequently added 10-layer nested scenario isolates prefix-reparsing work more directly; retain this change for its security/correctness improvement only if full integration checks stay green.

The next scaling revision introduces 100, 1,000, 5,000 and 10,000-node browser workloads with exact DOM-identity checks and root teardown, plus Styles/Store synthetic diagnostics. These additions must pass on the latest head; if one variant fails, reject the measurements and fix the implementation rather than labeling a partial report successful.


## Production scaling evidence — run 42984045342 (November 11, 2026)

The full browser benchmark completed successfully at head `6301ec1a` (the concurrent Quality workflow failed **only** the React fixture's ESLint `URLSearchParams` global declaration; the fix is staged separately for final-head validation). All matching application builds, 100–10,000-row key order, retained DOM-node identity and zero rows after disposal passed.

**10,000-row p50 milliseconds, production Vite:**

| Browser | React reverse | Frozen hardening reverse | Optimized reverse | React rotate | Frozen hardening rotate | Optimized rotate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Chromium | 162.3 | 39.1 | 39.4 | 163.0 | 43.3 | **4.5** |
| Firefox | 893 | 432 | 432 | 375 | 587 | **8** |
| WebKit | 885 | 108 | 104 | 35,589 | 1,502 | **6** |

This is **one shared GitHub-hosted CI machine**, with five measurement samples and one warmup per variant/size/operation. The extreme React WebKit rotation time (~35.6 seconds) is an observed result in a specific fixture, not a universal statement about React or WebKit. Repeat independently before making any public speedup claim.

Large full reversals require many native moves and have substantial latency: Firefox candidate ~432ms p50 for 10,000 rows. The sparse path benefits from minimum-move reconciliation, while the high-churn path keeps the WebKit-safe fragment batching. The alternative `Range.extractContents` strategy was explicitly rejected after a 1,000-row WebKit regression to ~361ms.

Synthetic Core/Signals, Compiler, Styles, Store and Router microbenchmarks also ran and recorded raw data. Router's broad/deep candidate p50 was slightly worse than hardening on this host, and Styles/Store show variation despite unchanged implementation; these are **not proven package improvements**. Do not optimize those packages without a reproducible profiling case and repeated evidence.

### Performance release-blockers remaining

- Repeated independent runs, dedicated runner noise characterization and varied hardware.
- Firefox full-list reversal remains slower than historical main on some runs.
- Memory retention and garbage-collection verification beyond browser DOM teardown.
- Real application LCP/INP, large forms and route transitions, SSR/hydration (not yet complete).
- Package-by-package production workloads for integrations not directly represented by microbenchmarks.

The performance PR should accurately describe these as **open certification scope**, not claim all 23 packages are optimized.

## Discarded compiler-target diagnostics experiment (November 11)

An isolated source-file-scoped TypeScript diagnostic request was tested against the frozen hardening implementation on the same GitHub runner (Actions [42986548606](https://github.com/sanukhandev/zaakiyjs/actions/runs/42986548606), candidate experimental branch `experiment/compiler-target-diagnostics`). All 92 Vitest files passed, but 16 measured fresh-compilation samples found p50 **210.59 ms** for the experimental candidate versus **202.64 ms** for hardening. The change has **not been adopted**. These separate-process microbenchmarks have run-to-run variation; a slower single run is sufficient reason not to claim a benefit, not conclusive proof of a universal regression.


## Accepted deep-router optimization experiment — November 11, 2026

A separate isolated branch `experiment/router-precomputed-match` was tested in CI run [43003573220](https://github.com/sanukhandev/zaakiyjs/actions/runs/43003573220). Its precomputed route-layer metadata reduces repeated parameter-prefix construction on match. The measured nested 42-route, 10-layer benchmark improved from hardening **0.04475 ms p50** to optimized **0.03647 ms p50** (approximately 18.5% less latency), with broad 514-route matching **0.03236 → 0.03116 ms**. Full 91-file Vitest suite (858 passed, 1 skipped), build, lint and typecheck passed in the isolated experiment. This is a single-run Node microbenchmark, not an end-to-end navigation guarantee. The compiled metadata is stored in a WeakMap keyed by route entries; externally constructed RouteTable inputs retain a safe lazy fallback.
