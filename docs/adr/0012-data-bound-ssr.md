# ADR 0012 — Read-only loader-data bindings for compiled SSR

- **Status:** Experimental integration on PR #61, awaiting final-head CI and review
- **Invariants:** IR v1 and DOM ABI v1 unchanged; no runtime TSX interpretation; no native DOM hydration yet

## Problem

A literal-only compiled server module renders safe static HTML but cannot display per-request route data. General JS expression evaluation inside a server renderer would permit unreviewed access to services, secrets, network calls, getters and arbitrary user code. It would also leave build/runtime identity and caching assumptions underdefined.

## Decision

`compileDataServer({ fileName, source, routeId })` is an additive, strictly bounded compiler server target. It accepts a single native HTML root with static attributes and **only** simple nonreactive primitive text reads of type `props.customer.name`. At request time the generated `zaakiy.render/1` module maps these paths to `context.loaderData.customer.name`, using own-property descriptors. It does not evaluate the TSX expression, access inherited properties, execute getters, accept arrays/object values as text, or import the compiler. Other JSX constructs, including components, dynamic attributes, event handlers, unsafe elements, keyed regions, signal reads, calls, and URL props, fail compilation.

Safety limits: four nested property names, 4096 IR nodes, 64 levels of HTML nesting, bounded source/generation size, 65536 chars per text value, and 1 MiB per rendered body. All interpolated text is escaped before inclusion in HTML. Requests require the exact compiled route ID and respect cancellation. Output defaults to **private, no-store** via the existing server response adapter. The exported module is byte-derived and verified by the build manifest, then loaded into a pinned trusted module registry. No request can choose a module from its URL.

## Build and integration proof

After `pnpm build`, `scripts/ci/data-ssr-smoke.mjs` compiles an example TypeScript/TSX route, calculates a SHA-256 artifact manifest from the real emitted module bytes, imports that exact ESM source, attaches it to the already accepted Router and Node SSR adapter, and verifies independent concurrent route data, HTML escaping, HEAD, 404, no-store policy, getter rejection, oversize values, and tampered artifact blocking. Compiler unit tests cover valid/invalid expression grammar and deterministic output.

## Non-goals and remaining work

This is neither a general-purpose JSX server renderer nor client hydration. It lacks component trees, server-generated hydration markers and node-adopting/owner-scoped client binding. A future versioned IR and hydration ADR must specify those guarantees and prove them with production browser tests. Full SSR issue #59 and component slots issue #37 remain open. Npm publishing remains blocked by issue #24.

This incremental API does not allow unsupported syntax to fall back to arbitrary code execution, client-only rendering, or silent conversion of objects to strings.
