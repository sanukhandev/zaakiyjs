# H4/H5 hydration implementation ledger — 2026-11-12

Branch: `feat/production-hardening-integration`; tracking PR #61 (draft).

## H4 — not certified / not implemented

The existing `zaakiy.data-hydration/1` contract supports one fixed native root and
bounded, data-bound text slots. It intentionally rejects executable TSX,
nested components, fragments, conditionals, keyed loops and dynamic events.
Do **not** pass these nodes through the restricted hydration path or claim
component hydration. Completion requires a versioned compiler/DOM region ABI,
same-tree server and client generation, key-stable adoption, state restoration,
event attachment/disposal and three-browser regression tests.

## H5 — safe state transport increment

`@zaakiyjs/ssr/client` exports `serializeHydrationState` and
`parseHydrationState`. This opt-in JSON-only transport enforces:
- Explicit 64-hex build identity and bounded route identity at encode and decode.
- Plain own enumerable properties; no getters, prototype keys, non-JSON types,
  cycles or shared object graph.
- Finite numbers, <=32 levels, <=4096 items and <=65536 UTF-8 bytes.
- Escaping of HTML/script-breaking characters and Unicode line separators.
- No automatic DOM reads, state injection, hydration or application-state merge.

Only explicitly approved **public** data may be passed to the serializer;
the library cannot automatically classify secrets. Avoid embedding private
loader fields or session credentials. Put the output in a non-executable JSON
script using `textContent` (not `innerHTML`); parse only after checking
the trusted manifest, route and deployment build.

## H5 navigation safety increment

The restricted `hydrateDataPage` API now accepts an optional caller `signal`,
refuses pre-aborted navigation and disposes its DOM owner/listeners on abort.
The native DOM root and SSR markup remain intact. A jsdom acceptance test
verifies disposal, repeated adoption and pre-abort nonmutation.

The browser client now exports `createHydrationTransitionCoordinator`. A route
transition aborts its predecessor; synchronous `commit` refuses stale or
aborted generations. External `AbortSignal`, dispose, malformed routes and
reentrant-abort navigation have focused regression tests. The coordinator is
an opt-in primitive, **not yet integrated with `@zaakiyjs/router` or SSR
stream delivery**. ADR 0015 proposes the future versioned region ABI.

## H5 bounded streaming and owned-boundary recovery increments

- `createHydrationStreamAssembler` accepts only monotonically ordered,
  identity-matched, bounded Uint8Array payload fragments. It copies each
  fragment and aborts permanently on malformed/duplicate/out-of-order data.
  Completed bytes are **inert**; no HTML parsing, DOM attachment or implied
  authorization occurs.
- `hydrateOwnedBoundary` offers an opt-in lower-level H5 primitive for a
  validated `zaakiy-r2:<id>:start/end` bounded region. It keeps existing
  native nodes for a matching boundary, refuses mismatch without explicit
  recovery, prepares detached replacements before mutation, preserves
  unrelated siblings, supports parent-scoped cleanup, and attempts rollback
  on setup/mount failure. The caller must independently verify the trusted
  compiler blueprint, build, route, partition and marker ownership.
- Added jsdom tests for matching attachment, default mismatch abort, scoped
  replacement, rollback, cancellation, and stream ordering/budgets.
- These are **manually composed low-level primitives**, not proof of
  compiler-generated interactive H4 regions or a validated router/stream
  application integration. In particular, no compiler emits the region v2
  markers yet.

## H5 remaining acceptance blockers

1. Compiler-generated v2 region markers, nested boundary ownership and
   independent production tests of opt-in replacement/rollback.
2. Integrate navigation guard and inert ordered-fragment assembler with
   actual router and streamed SSR adapter, including concurrent requests.
3. Explicit client state initialization, selective redaction/allowlisting and
   prevention of cross-user/tenant state reuse.
4. Integration tests with dynamic component/keyed/conditional hydration,
   navigation cancellation and Chromium/Firefox/WebKit browser acceptance.
5. Final-head full Quality, security, release and benchmark evidence.

**Status:** H5 state transport incremental implementation, not H5 completion.
H4/H5 production acceptance remains open. Keep PR #61 draft; no merge/publish.
