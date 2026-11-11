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
