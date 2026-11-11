# B5 — Finish Direct Diagnostic Workload Coverage for 23 Packages

This is a **benchmark-only** slice stacked on the optimized
`perf/b4-ui-primitives-roving` branch. It does not change the five measured
package runtimes or close/merge PRs #61–#63.

## New directly measured package workloads

| Package | Diagnostic workload | Correctness assertion |
| --- | --- | --- |
| `@zaakiyjs/ads` | 100/1000 SSR placeholders | Escaped accessibility label, stable slot identifier and no scripts |
| `@zaakiyjs/cli` | Minimal/standard/enterprise scaffold plans | Expected file counts, no placeholders, identical SHA-256 source plan |
| `@zaakiyjs/ssr` | 1/50-route trusted no-store request pipeline | Trusted manifest and exact HTML response, owner cleanup |
| `@zaakiyjs/motion` | Default/stiff spring integration with deterministic RAF | Correct finish, finite values and zero retained queued frames |
| `@zaakiyjs/ui` | 50/200 native Button/TextField instances in jsdom | Semantic node output and disposed event listeners |

Each new workload runs on pinned Node 22 against an immutable B4 reference on
the same GitHub runner. Raw samples, p50/p95, fixture identity and required
output equivalence are archived. These are diagnostics, not performance claims.

## Full coverage matrix

The initial seven directly measured packages were Signals, Core, DOM,
Compiler, Styles, Store and Router. B1 measured Forms and Analytics; B0 added
Async, HTTP, Compat and SEO, then Proxy, Consent and Templates (16). B2
provided an optimized, verified Proxy comparison; B3 added real Vite
production-build timing (17), and B4 added UI Primitives roving focus (18).
B5 adds Ads, CLI, SSR, Motion and UI. **23/23 packages will then have at least
one direct performance workload once the CI checks finish successfully.**

This count does **not** mean 23/23 optimized or production-certified. Coverage
varies by quality: synthetic Node, jsdom and browser production workloads
have different inferential strength. Motion physics is not animation frame
budget; SSR rendering does not establish live TSX hydration (#59);
placeholder generation does not establish real ad-network CLS; CLI planning
does not measure installation speed.

## Reference policy

React 19.2.4 remains a valid rendering comparator only for semantically
equivalent UI update workloads in the existing production browser suite.
For CLI, Proxy, consent, SSR trust-boundary and privacy packages, direct
before/after public APIs are the appropriate primary reference.

## Next optimization candidates after coverage

- Vite: profile incremental CSS graph invalidation and warm-cache HMR with
  sourcemap, deterministic hash and owner-disposal assertions.
- UI and Motion: large real-browser applications with keyboard, focus and
  reduced-motion parity, measured input/event latency and retained memory.
- SSR: trusted module render throughput, safe streaming cancellation,
  response cache isolation and eventual supported hydration protocol.
- Ads/Consent/Analytics: realistic consent-revocation workloads and measured
  third-party script loading without weakening privacy boundaries.
- CLI: actual CLI package cold start and scaffold/install time with offline
  reproducibility.

Optimize only after repeated independent comparisons and verified correctness.
