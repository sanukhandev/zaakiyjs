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


## Certification gate corrections

At candidate `185478cc8f5361b8cec780c42b5d7d7ffd89b991`, 16 of 18 workflows
passed. The two earlier owner-leak tests passed; the remaining Quality
failure was Chrome process ETIMEDOUT in the native DOM smoke test, not
a reported DOM assertion failure. A unique Chrome profile and bounded
90-second process timeout address CI startup contention without skipping
or retrying away failed behavior assertions.

B8 originally required byte-identical production JS/CSS and a canonical
asset manifest against the frozen B0–B5 baseline. That is appropriate for
compiler/build-only optimization, but intentional runtime edits change the
entry chunk and its content-addressed name. The reporter retains strict
byte equality as its default. The integrated B8 workflow explicitly selects
the reviewed-runtime-delta comparison, requiring identical fixture source
hashes, compiler-emitted TSX JS, stylesheet bytes, HTML and canonical
manifest metadata (only the validated entry filename is normalized),
and actual native browser behavior. Each variant must still independently
produce byte-identical repeated builds. The manifest must cover every
emitted JS/CSS asset; missing, extra or conflicting asset records fail.
All raw executable hashes, compressed byte counts and browser assertions
remain available for review. This is not a claim of full equivalence for
arbitrary applications: the native fixture checks independent counters,
CSS, exact targeted mutations and DOM identity. Full H4, M1, Quality,
release hardening and paired performance checks remain required.
Size increases are reported, not approved by the comparator.

These are candidate test/infrastructure changes; certification requires
the new exact-head workflow results.


## Native flat-list architectural checkpoint

See [compact-v3 ADR](../adr/compact-v3-flat-keyed-hydration.md). This candidate
selects a resource-free scalar list path at compile time, parses static row
metadata once per list, combines the v3 root marker proof with structural
preflight, removes both row comments, and skips all per-row owners/effects.
The flat list and the generic range list share native movement planning.
Legacy and complex rows retain their existing semantics. The new format
requires explicit snapshot mode and compiler-declared events only.

The full H4 comparison still measures the complete hydration workload. The
paired workflow now includes main, #99, the prior compact-v2 candidate
185478c and compact-v3, with three independent trials per browser and 50
samples per variant/size/trial (3,600 samples). Diagnostic counters assert
all benchmark rows take the flat path and no per-row owner is created.
A separate ordinary Vite application build is measured without benchmark
instrumentation and validated in all three engines, including counter,
row replacement/add/remove/reorder, conditional update and disposal.
Its size is distinct from the historical full harness, not a substitute
for the original comparison. The compiler marks specialized regions, but
the general route hydration entry remains in use; fully separate
capability-specific generated client entrypoints are not implemented here.

The previous CI helper lint issues were corrected with explicit Node timer
imports and JSON-only evidence cloning. All exact-head results still need
review. No target attainment, merge, release or general runtime equivalence
is claimed before CI evidence.


## Final bounded optimization and runtime freeze

This candidate is the end of the discretionary runtime optimization program.
The compiler emits a deterministic static browser entry and selects the
restricted flat-v3 runtime only for eligible templates. Existing marker
formats, generic fallback and public hydration API are retained. Shared
validation code verifies every row; the final native layout and snapshot
check runs together after the reactive read, rather than trusting an
unchecked adoption flag. Initial flat-list callbacks capture the collection
path rather than the preflight list descriptor. The specialized entry clears
its temporary attachment arrays after adoption.

The H4 production and clean application fixtures use the actual generated
client. Rollup attribution must prove the flat client module is retained and
the generic hydrate-region module is absent for the specialized fixture.
Diagnostic builds profile the selected entry. The paired gate compares five
pinned versions: main, PR99, compact-v2 at 185478c, compact-v3 at 78c1e3c,
and the final candidate (4,500 measured samples). The incorrect nested
manifest lookup and the percentile-insensitive Vite negative test have been
corrected. The original historical fixtures, exact source identity, full
browser behavior, strict reproducibility and raw measurements remain required.

Runtime scope is frozen at this checkpoint for UAT and beta certification.
Only confirmed correctness, security, compatibility or certification blockers
may reopen the runtime; no further speculative optimizations or new marker
formats. Final metrics remain goals, not conditions for fabricating results.
Report any missed size or latency target transparently, investigate persistent
performance regressions, and make a reviewed beta scope decision after all
required checks. Full H4 fixture size and clean application bundle size remain
separate. The CSR 8 KiB target is still unverified; this round does not add a
new minifier or change the general CSR compiler. No merge, tag, npm publish,
or production readiness claim until exact-head evidence is reviewed.
