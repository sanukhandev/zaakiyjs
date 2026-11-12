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

## H5 remaining acceptance blockers

1. Versioned nested owned-boundary mismatch policy; abort-by-default and
   opt-in replacement of **only** owned boundaries with transactional cleanup.
2. Route-transition races and stream/partial-chunk interleaving with
   cancellation, sequence ordering and bounded buffering.
3. Explicit client state initialization, selective redaction/allowlisting and
   prevention of cross-user/tenant state reuse.
4. Integration tests with dynamic component/keyed/conditional hydration,
   navigation cancellation and Chromium/Firefox/WebKit browser acceptance.
5. Final-head full Quality, security, release and benchmark evidence.

**Status:** H5 state transport incremental implementation, not H5 completion.
H4/H5 production acceptance remains open. Keep PR #61 draft; no merge/publish.
