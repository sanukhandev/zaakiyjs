# O1–O7 performance program — candidate checkpoint

Pinned baseline: `main@b0da54d2bdfb9c984cf0409755fafc98b940f183`.
Branch base: `PR #99@afb71fd8e9f175271e832fac34c776c2570c51ed`.

This branch implements the first vertical slice of the program, not the whole
release. No performance victory, UAT completion or beta release is claimed
until exact-head evidence is complete.

| Phase | Current slice | Outstanding |
| --- | --- | --- |
| O0 | Paired main/PR99/candidate benchmark | Repeat same-runner trials; resolve #99 regression |
| O1 | Pinned browser workers, environment and raw sample provenance | Per-phase CPU/allocation profiles |
| O2 | Consolidated discovery, empty validation/listener allocation fast paths | Binding specialization, keyed adoption and plan optimizations |
| O3 | Existing marker format retained | Versioned payload RFC and measured changes |
| O4 | Lazy computed-read and owner resource collections | DOM reconciliation fast paths and further profiling |
| O5 | Measure full existing fixture size unchanged | Module attribution, clean fixtures, minifier and compiler profiling |
| O6 | H4 four-framework matrix and paired Zaakiy builds | Equivalent Vue/Angular CSR, repeated independent trials |
| O7 | Existing exact-head correctness/security/browser gates | Integrated final certification, package audit and application UAT |

## Evidence and gates

The paired workflow builds main, PR99 and the candidate from pinned source,
using an identical fixture and Node/pnpm versions. Each browser worker runs
two counterbalanced blocks of 25 measured samples per variant and list size
(1,000 and 10,000), retains all raw data and checks hydration correctness,
identity, focus, interactions, disposal and zero adoption mutations. The
existing full H4 comparative certificate remains required, not replaced by
the targeted same-runner experiment. A p95 increase above 5% requires
investigation, not automatic causal attribution. Repeat independent runs
before making a merge decision.

The benchmark identity check now queries the adopted rows once after the
hydration timer stops. This preserves the identity assertion and avoids an
unrelated quadratic DOM traversal. Existing marker format and rendered DOM
semantics are not changed. Avoid eliminating item-derived effects until the
compiler can prove that doing so preserves all dependency reads and update
semantics.

Do not merge this stack until PR99 is certified and integrated, the candidate
passes exact-head checks, and the paired evidence has been reviewed. No
package publication or release tag is authorized.
