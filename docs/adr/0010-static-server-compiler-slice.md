# ADR 0010 — Literal-only compiler server output (incremental SSR)

- **Status:** Proposed implementation on PR #61; not yet a full SSR/hydration acceptance.
- **Scope:** `@zaakiyjs/compiler` build-time API and `@zaakiyjs/ssr/build` artifact-attestation pipeline.
- **Compatibility:** Browser compile() and frozen DOM/IR v1 remain unchanged.

## Problem

ZaakiyJS currently compiles TSX into native browser DOM code. The SSR transport and trusted-module registry can serve a host-authored server module, but there is no compiler output target. Interpreting TSX at request time, importing the browser DOM inside Node, or claiming that a marker probe is hydration would violate the rendering contracts.

## Decision

Introduce an additive `compileStaticServer({ fileName, source, routeId })` compiler entry point for **literal-only, noninteractive HTML TSX**. It validates the existing v1 IR and emits a standalone ECMAScript `zaakiy.render/1` module whose `render(context)` returns a bounded, precomputed HTML string with `no-store` cache policy. The module does not import a TSX compiler, evaluate user source, import DOM libraries, or execute JSX on HTTP requests.

All supported literal HTML text and attributes are escaped at build time. Dangerous attributes and URL schemes, inline styles, event listeners, dynamic text, signals, components, keyed loops and SVG are rejected with actionable diagnostics instead of silently discarded. A restricted tag/attribute allowlist prevents executable markup and custom-attribute collisions. Only a single static element root is supported. HTML text is not a raw-HTML escape hatch.

The compiler returns the **exact emitted server module bytes** as a generated asset. The deployment/build workflow passes those bytes to `buildVerifiedManifestV1` and `verifyTrustedArtifactBytes` in `@zaakiyjs/ssr/build`, then uses `createByteAttestedNodeServerAdapter` with a registry bound to those same files. Do not trust a digest claimed by application code.

## Invariants

1. No change to compiler IR schema 1, or browser DOM ABI 1.
2. No implicit server execution of arbitrary TSX expressions or user-defined components.
3. No hydration markers or claim of listener adoption; static output is noninteractive.
4. Deterministic output for identical source and route identity; source bytes are hashed by the trusted build layer.
5. Escape HTML text and attributes; reject unverified URLs, events and inline style.
6. Keep SSR request isolation in the existing Node adapter; no global request state.
7. Unsupported constructs fail compilation rather than falling back to client rendering or serializing dynamic values.

## Required follow-on work for issue #59

Create a separately reviewed compiler SSR target for dynamic expressions and native components, with a versioned compiler/DOM hydration contract. The full target must prove server/client element identity, signed/verified manifests, adopt existing nodes without replacing controlled inputs, maintain listener ownership, and pass Chromium/Firefox/WebKit acceptance plus two-tenant HTTP isolation, CSP, cancellation and performance gates.

**This ADR does not close issue #59, #37, or the release authorization issue #24.** It only creates a compile-time server output slice that can be byte-attested and served by the existing SSR transport.
