# ADR 0015 — H4/H5 interactive region hydration (proposed, not implemented)

**Status:** Restricted H4 SSR + browser adoption slice implemented behind explicit opt-in;\nrestricted conditional/keyed reconciliation and pure local component adoption are implemented;\nfull general-purpose TSX hydration remains proposed.\n`zaakiy.data-hydration/1` (ADR 0014) is unchanged.

## Compatibility decision

Introduce a **separate** opt-in `zaakiy.region-hydration/2` plan and
`zaakiy-dom-region/2` marker protocol. The compiler must emit server HTML and
client binding plans from **the same** versioned optimized IR. Do not widen
the restricted v1 data plan to accept unvalidated TSX. DOM ABI v1 and normal
`mount()` behavior remain unchanged.

## Identity and ownership

- Stable `buildId`, `routeId`, `templateDigest` and compiler-assigned
  `boundaryId` identify each boundary; every nested boundary ID is unique.
- A region is delimited by two ordered, uniquely identified comments,
  `zaakiy-r2:<boundaryId>:start` and `zaakiy-r2:<boundaryId>:end`.
  Compiler IR represents fragment, component, conditional, and keyed-loop
  regions distinctly; each key is canonicalized and escaped, never executed.
- The region's owner is a child of its containing owner. Event handlers,
  subscriptions, async work, portals and exits belong to that owner and must
  dispose once. Keyed reorder must preserve DOM, focus, selection and owner
  identity for stable keys; deleted keys dispose exactly once.
- The compiler must reject unsupported expressions or constructs before
  generating SSR output. Client never evaluates server source or imports Node
  compiler modules.

## Two-phase adoption

1. Verify the trusted manifest, route/build identity, template digest,
   bounded marker tree, key uniqueness, tag/namespace, stable attributes,
   event target IDs, text/region ownership and initial state.
2. Only after a successful **whole-boundary** preflight attach scoped owners,
   event listeners and reactive bindings to the existing nodes. A matching
   attachment produces zero DOM replacements and preserves input/focus.
3. If mismatched, default to **abort with no mutation**. Opt-in replacement
   must target exactly one compiler-owned bounded region, prepare a new native
   tree off-DOM, atomically swap within verified markers, clean its old owner,
   and roll back on factory or attachment failure. Never replace an ancestor,
   unrelated siblings or third-party-owned descendants.
4. Do not recover from manifest, build, route, tenant or trust mismatch by
   client-rendering a potentially untrusted boundary.

## H5 route/stream contract

- Route navigation increments an opaque generation; old async work must
  observe AbortSignal and check generation immediately before synchronous
  DOM commit. `createHydrationTransitionCoordinator()` implements this
  basic commit guard; it does **not** hook the router automatically.
- Stream fragments must be associated with a trusted route generation and
  monotonically increasing per-boundary sequence; enforce total byte,
  depth and pending-fragment bounds. Reject duplicate/out-of-order boundary
  completions and stale route updates; never parse arbitrary streamed HTML
  by `innerHTML`.
- Only allowlisted public state may be serialized. The new
  `zaakiy.hydration-state/1` JSON transport is an opt-in primitive,
  not a privacy classification or automatic state restoration mechanism.
- Tenant/user partition identity must bind server cache, payload,
  hydration envelope and client navigation; never trust a caller-provided
  tenant string as proof of authorization.

## Required implementation/test milestones

1. Compiler IR v3 or explicit additive IR v2 extension and golden SSR/client
   plan parity, source maps and fail-closed diagnostics.
2. DOM region owner adoption, keyed list identity, conditionals, nested
   components/slots and event lifecycle integration.
3. Strict boundary preflight, transactional local recovery, rollback and
   no-leak teardown.
4. Route adapter/cancellation, partial and interleaved stream handling and
   tenant-sensitive state integration.
5. Three-browser production integration, CSP/XSS, axe/accessibility,
   slow-network/navigation races, retained heap and release verification.

**No public release and no PR #61 merge until behavior exists and tests pass.**

## Initial H4 compiler/browser slice (2026-11-12)

- `compileRegionServer({fileName,source,routeId})` lowers validated `StaticElement`,
  `DynamicText` data paths, `ConditionalBlock`, one-level `KeyedLoop` IR,\n  and pure local component calls with mapped data props
  to a deterministic `zaakiy.region-hydration/2` plan and reviewed Node SSR
  module. Stable marker digests and exact text-slot comment markers are emitted.
- The Node module validates request route and safe loader-data paths,
  escapes interpolations, checks keyed uniqueness and bounds output.
  It emits no user JS/TSX execution. Per-request work budgets are isolated.
- `hydrateRegionPage` verifies a trusted manifest/envelope, matching native
  nodes, static attributes, ordered conditional/keyed markers, initial text,
  and distinct native identities **before** owner/effect/listener creation.
  It uses DOM owner-scoped keyed and conditional reconciliation after initial\n  adoption, preserving retained nodes on updates. It preserves matching DOM,\n  focus and input state and supports explicit
  trusted event mapping to compiler-assigned element identities.
- Current restriction: one native root, no arbitrary imported components or\n  named-slot lowering,
  JSX event expressions, nested keyed loops, runtime keyed reconciliation,
  automatic branch switching, or general signal-dependent server rendering.
  Matching snapshot adoption is useful but **not full H4 certification**.
- SSR module executable and browser adoption tests are included. The latest
  head requires TypeScript, tests, Chromium/Firefox/WebKit and security checks.
