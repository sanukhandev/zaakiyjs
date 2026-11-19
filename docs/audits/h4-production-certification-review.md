# PR #61 — H4 production certification and review record

## Scope and status

This audit covers opt-in `zaakiy.region-hydration/2` only. It does **not**
authorize merging PR #61, publishing npm packages, or claiming that React,
Vue, Angular and ZaakiyJS are identical across arbitrary TSX workloads.

The prior `zaakiy.hydration/1` and v1 native DOM ABI must remain unchanged.
The optional 10,000-row budget and `markerFormat: "compact-v1"` are included
in a deterministic compiler-authored v2 plan and its fingerprint. A v2 plan
without `markerFormat` retains original long markers (even if its approved
large-tier limits exist). Unsupported formats must fail closed.

## Correctness and independent-review checklist

| Gate | Evidence / limitation |
| --- | --- |
| Four independent SSR implementations | React `renderToString`/`hydrateRoot`; Vue `renderToString`/`createSSRApp`; Angular 21 AOT `RenderMode.Prerender`/`provideClientHydration`; compiled ZaakiyJS H4 |
| Fixed workloads | 100, 1,000, 10,000 keyed rows and the same input draft, counter, conditional, and keyed reversal |
| Native adoption | Requires matching pre-existing row DOM identity, preserved draft/focus, attached handlers, correct updates/reversal and disposed listeners |
| Browser matrix | Chromium/Firefox/WebKit; 10 warmups and 50 measured fresh-page hydrations for each of 36 framework/browser/size combinations; publication requires 36 complete successes |
| Reporting | Raw samples, p50/p95/p99; mutation counts; exact dependency-lock hashes; raw/gzip/Brotli JS/CSS and SSR HTML. Startup/module-evaluation cost is **not** included in measured hydration interval |
| Owner cleanup | Separate ZaakiyJS **100 cycles** at 100 and 1,000 rows on each browser, forced GC, weak references to disposed owners, retained node identity and no stale click listeners |
| Heap bytes | `performance.memory` is nonstandard/quantized and **not** a cross-engine retained-byte measurement. WeakRef/GC clearance establishes owner collectability, not all allocations or framework heap parity |
| Security | Safe row keys, explicit data-marker collision rejection, no HTML execution, pinned build/route, 50k plan node budget, 10k row budget and 8MiB UTF-8 server-output budget |
| v1 compatibility | Existing `hydrateDataPage` and DOM ABI unchanged. No implicit global patches, no browser compiler or eval |
| Peer approval | **Not yet obtained**; independent reviewer must inspect the final commit, benchmark raw artifacts, supported subset and limits |

The benchmark fixtures are intentionally narrow. They do not test all nested
component/slot APIs, network latency, general TSX closures, accessibility of
a realistic business app, or Angular-equivalent compiler output. Those claims
require separate test cases and review.

## Marker-overhead measurements

Generated 10,000-row SSR payload compared with a **counterfactual expansion**
to previous v2 marker syntax, keeping the same data and output order:

| Transfer format | Previous v2 syntax | Opt-in compact-v1 | Reduction |
| --- | ---: | ---: | ---: |
| Raw HTML | 2,657,191 bytes | 1,317,141 bytes | 50.4% |
| Gzip level 9 | 92,076 bytes | 84,700 bytes | 8.0% |
| Brotli | 42,893 bytes | 35,348 bytes | 17.6% |

The exact generated evidence is in the `h4-reference-build-*` artifact
(`zaakiyjs-build.json.markerImpact`). The expansion is an exact marker-format
counterfactual, **not** an earlier historical CI production run or evidence
that runtime hydration sped up. The comparison excludes HTTP transport and
client startup time.

## Release blockers

1. All 36 final-head browser cases must pass; reject omissions, failed
   hydration, mismatched identity or incomplete raw samples.
2. The 100-cycle owner-retention job must pass at the final head, in all
   three browser engines. This is *owner collectability* evidence only;
   cross-framework retained-byte claims still require calibrated heap tooling.
3. Complete an external/independent human review of the trusted renderer,
   compact-marker security, ownership cleanup, v1-ABI preservation and
   benchmark parity; no author self-approval.
4. Rerun the required exact-commit Quality, Release Hardening, H6, M1 Browser,
   and React-reference checks after any changes.
5. Keep PR #61 **DRAFT/UNMERGED** until the above conditions are met.

Do not compute speedup percentages from runs that are cancelled, mixed across
commits, use different workload semantics, or include fewer than 50 measured
samples per framework/browser/scale.
