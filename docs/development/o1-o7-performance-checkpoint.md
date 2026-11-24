# O1–O7 performance program — second candidate checkpoint

Pinned baseline: `main@b0da54d2bdfb9c984cf0409755fafc98b940f183`.
Branch base: `PR #99@afb71fd8e9f175271e832fac34c776c2570c51ed`.

This is an optimization candidate, not a certified release. No benchmark
victory or beta readiness is claimed until the updated exact-head evidence
is complete.

| Phase | Implemented candidate changes | Outstanding |
| --- | --- | --- |
| O0 | Three independent paired main/PR99/candidate trials per browser | Review completed exact-head evidence |
| O1 | Separate diagnostic build with eight phase timings, total and counters | Review profiles and isolate remaining bottlenecks |
| O2 | Unified discovery, lazy item cells, explicit snapshot text binding, equal keyed adoption fast path | Measure gains and check complex nested workloads |
| O3 | Opt-in compact-v2 scalar marker elimination | Measure compressed HTML, validate legacy compatibility |
| O4 | Lazy owner/derived-read collections, keyed prefix fast path, corrected leak assertions | Review rename/prepend and high fanout |
| O5 | Compiler scalar specialization and per-module Rollup attribution | Analyze actual attribution; general compiler/cache/minifier work |
| O6 | H4 four-framework matrix, repeated paired Zaakiy trials, existing React CSR | Equivalent Vue/Angular CSR remains open |
| O7 | Exact-head correctness/security/browser gates and candidate API documentation | Integrated final certification, package audit and application UAT |

## Trust and compatibility

Both new features are opt-in: the large-list compiler option
`hydrationMarkerFormat: "compact-v2"` preserves existing standard and
compact-v1 plans. The client option `itemDataMode: "snapshot"` applies only
to immutable plain row objects without reactive descriptor/proxy reads.
Default tracked bindings remain unchanged. See the SSR package README.
No boundary identity, unsafe path, text budget, attribute or owner
validation is removed.

The two failing white-box leak tests now count a lazily unallocated child
collection as zero. They still compare every teardown to the baseline and
retain their behavior/focus assertions. Regression tests cover the keyed
prefix mismatch, truncation and duplicate rejection; proxy-backed default
tracking; snapshot text updates; markerless native identity and tampering;
and server escaping and version selection.

## Evidence and gates

The paired workflow builds main, PR99 and the candidate from pinned source,
using an identical fixture and Node/pnpm versions. The fixture requests
compact-v2 and snapshot item mode; historical compilers/clients ignore those
new options and produce their legacy builds. The application behavior,
hydration identity, updates, focus and disposal assertions are equivalent.
Each browser runs three independent trials; each worker runs two
counterbalanced blocks of 25 measured samples per variant and list size
(1,000 and 10,000). Raw samples are retained, not pooled across hosts.
A persistent >5% p95 increase requires investigation, not a waiver.

Separately, a disposable diagnostic source checkout is instrumented after
the normal candidate artifact has been uploaded. Profiles record protocol,
structural inspection, binding discovery, event validation, setup,
root-owner initialization, attachment and mount activation. Counters record
visited plan nodes, text bindings (tracked vs snapshot), listeners,
components, conditions, keyed lists and adopted rows. Instrumented timings
are never used for production comparison.

The H4 build emits a module attribution report using Rollup rendered module
lengths (not additive compressed module sizes), exact HTML/JS compression
metrics and the selected marker format. The existing full H4 comparative
certificate remains required, not replaced by targeted experiments.

Do not merge this stack until PR99 is certified and integrated, the
candidate passes all exact-head checks, and paired performance evidence
has been reviewed. No package publication or release tag is authorized.
