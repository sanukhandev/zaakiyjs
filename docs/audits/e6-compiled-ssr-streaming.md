# E6 — Bounded compiler-native streaming SSR slice

The restricted compiler loaderData server target now accepts streaming: true. It emits a build-generated module with an AsyncIterable<Uint8Array> response, supported by the existing @zaakiyjs/ssr/node adapter.

## Safety and performance constraints

- Fixed compiled IR remains the only source of HTML structure. Loader data is read using bounded own-property-only paths; no runtime TSX compilation, arbitrary calls, eval, or raw HTML sinks.
- The body is produced on demand by an async iterator. Chunks are UTF-8 encoded, output is capped at 1 MiB (characters), and the producer checks request abort before yielding and between fragments.
- The HTTP adapter is responsible for backpressure, cancellation and request-owner cleanup; response headers/status are established before streaming.
- The default non-streaming output is byte-identical to the original compiler. Browser DOM ABI v1 and the byte-attested trusted manifest remain unchanged.
- Malformed data or abort after streaming begins terminates the stream; HTTP status cannot be rewritten after headers commit.
- This does not adopt native DOM nodes, attach listeners, or implement general-purpose hydration.

## E6 follow-up gates

Compiler security/golden tests, byte-attested adapter integration, cancellation, HEAD handling, cross-request isolation, streaming throughput, browser hydration and CSP testing. SSR streaming itself is a bounded first E6 implementation, not full E6 certification.
