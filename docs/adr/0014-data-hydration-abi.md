# ADR 0014 — Restricted data-bound SSR → native DOM hydration contract

**Status:** Approved for a first, opt-in H0–H3 vertical slice; **not** general component hydration.

## Decision

Use the existing compiler-first IR, owner lifecycle, and native DOM bindings. Never introduce a virtual DOM or runtime TSX evaluator. Build-time `compileDataServer` with `hydratable: true` emits two artifacts from one optimized IR: an immutable `DataHydrationPlanV1` and server HTML containing compiler-stable root and text-slot comments. A separate client API verifies a trusted render manifest, hydration envelope and **exact native tree** before creating an owner and attaching bindings.

Retain DOM ABI v1. The new feature has an explicit `zaakiy.data-hydration/1` schema, distinct from the existing envelope `zaakiy.hydration/1`. The default unhydrated compiler output must remain byte-identical.

## Marker and layout contract

- One root comment immediately before one native HTML root: `zaakiy-h:<markerId>:<templateDigest>`.
- Each dynamic data-bound text slot: `zaakiy-t:<slotId>:start`, an existing text node if nonempty, `zaakiy-t:<slotId>:end`. Compiler-generated identities are 32-hex lowercase SHA-256 prefixes derived from route, slot ordinal and template structure. Template digest is the 64-hex SHA-256 of canonical compiled structural plan data.
- Plan records element tag, static attribute name and **escaped** value, literal text, and bounded loader-data paths. The browser validates every node, attribute, ordered comment, route/build marker and initial data text before mutations. Unexpected siblings/attributes/markup fail closed. HTML parser-reparented elements (table/select family) are rejected in this slice.
- Empty dynamic slots may insert one empty Text node after all preflight checks, before bindings are attached. Matching nonempty server text nodes and existing elements are preserved exactly. No `innerHTML`, `eval`, `Function`, dynamic source execution, global Promise patching or client compiler imports.

## Ownership and cleanup

- The low-level `hydrate(existingNode, attach)` in `@zaakiyjs/dom` allocates one owner and rejects a second concurrent adoption for that root. No DOM mount range is inserted and disposal never removes SSR markup.
- `hydrateDataPage(container, plan, envelope, manifest, routeId, { read, events? })` in `@zaakiyjs/ssr/client` uses existing owner-scoped `bindText` and `listen`. `read(path)` is trusted client application code and must initially return the same primitive text as the server, to prevent flicker and user-input loss.
- `events` target compiler-generated element IDs, not arbitrary selectors. The existing restricted data SSR compiler does not compile server JSX event expressions; handlers are wired explicitly from the client. Duplicate event registration or unknown target is rejected before owner creation.
- Disposal removes effects/listeners and allows rehydration; existing inputs, focus and DOM identity remain unchanged.

## Security boundary

- Manifest and envelope are deployment-controlled. The manifest's buildId is computed from exact server module bytes by `@zaakiyjs/ssr/build`. Hydration is refused on inconsistent build IDs, routes, markers, template digests, static tags or attributes. This prevents accidental mismatched content adoption; a plan supplied by an attacker is outside the trusted build contract.
- SSR data is escaped. Accessors/prototype paths and object-valued interpolations are rejected by the existing data SSR compiler. The client checks primitive initial values and size bounds.
- No untrusted serialized state is automatically read from the DOM; approved state transport and redaction remain separate responsibilities.
- The browser-side binder does not claim ownership of arbitrary third-party DOM. Only the validated root is adopted.

## Explicit exclusions and next phases

H4: keyed regions, branches, fragments, nested components and hydration state initialization require a versioned element/region ABI and tests for keyed focus, disposal and replacement of one owned boundary.

H5: route transition, suspense/streaming payload interleaving, mismatch fallback (`abort` or replace only owned boundary) and secure serialized state integration are not implemented by this first slice.

H6: verify zero DOM replacements for matching markup, one listener per event, complete cleanup, 3-browser hydration, accessibility, memory and benchmarks against equivalent production React/Vue/Angular hydration; no universal speed claim without comparable measurements.

## Tests and release gate

- Golden default SSR bytes unchanged with hydratable opt-out.
- Stable IDs and plan reproducibility, CSP-safe encoded text, hash-bound envelope and alternate build/route rejection.
- Native matching-node identity, focus and user-edited input preservation, reactive text updates, single-owner listener registration/disposal, duplicate hydration rejection and preflight nonmutation.
- Streamed HTML marker compatibility and explicit non-support for dynamic components/regions.
- PR must retain full TypeScript, Vitest, browser, security and release checks. No merge or npm publish with red checks.
