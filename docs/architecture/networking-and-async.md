# Async Resources, HTTP Interceptors and Secure Proxy

## Boundary separation

- `@zaakiyjs/async`: reactive resources and tasks over **native** JavaScript Promises.
- `@zaakiyjs/http`: typed Fetch transport with request/response/error interceptors.
- `@zaakiyjs/proxy`: optional **server/edge-only** named-upstream gateway; not a browser proxy.
- `@zaakiyjs/router`: frontend navigation and page adapters; not the HTTP proxy.
- `@zaakiyjs/core`: ownership scope and cleanup registration.

No Promise monkey-patching or Zone.js-style global async interception.

## Reactive async design

`createResource` is for read-oriented operations: key, fetch/load, pending/data/error, stale policy, cache tags, refresh, optional suspense and scope-controlled cancellation. `createTask` is for explicit mutations: pending/result/error, run, cancel, idempotency and concurrency (`latest`, `queue`, `parallel`, `reject`). They are proposed APIs. Separate user error, transport error, timeout and abort semantics. Prevent stale replies overwriting the newest resource state.

Use native `AbortController` and `AbortSignal`; compose caller, scope, navigation and timeout signals with a compatibility-safe strategy. Abort outstanding framework-owned requests on owner disposal; distinguish KeepAlive deactivation and permanent disposal. Cancelling transport is **not proof** that server-side work was rolled back; enforce server-side idempotency for writes.

## HTTP client

Typed request/response/error interceptor chains with deterministic order and controlled short-circuiting. Support content parsing, schema validation, request correlation ID, redacted tracing, auth failure normalization and bounded retry only when safe (idempotent or server-idempotency-key protected). Never auto-forward cookies, Authorization or arbitrary headers to a newly selected upstream.

Auth refresh should single-flight and fail closed. Client-side guards are UX only; backend authorization remains authoritative. Request/response data must be tenant/user-scoped in shared caches.

## Server proxy security

Declare **named, allowlisted** upstreams in server-only config; forbid arbitrary user-provided hosts/schemes, DNS rebinding, private network targets not explicitly approved, unsafe redirects and leaking hop-by-hop headers. Enforce authn/authz per route, method/path allowlists, payload/body-size limits, rate limits, timeouts, structured error policy, safe retries, trace IDs and audit logging. Prefer restricted egress and defense in depth against SSRF.

Develop with Vite proxy adapter when appropriate but do not confuse it with the production reverse proxy. Server-only secrets must never be emitted into browser bundles. Streaming/WebSocket support is deferred until explicit security contracts and browser tests exist.

## Consistency and SSR

Cache keys must include identity/tenant context where required. A mutation may invalidate client resources, relevant stores, SSR cache entries and dynamic SEO pages through explicit tags/events. Authenticated pages must never use globally shared public caches unless data is proven public.

## Generator targets

`zaakiy g api-client`, `g interceptor`, `g resource`, `g task`, `g middleware --target proxy`, `g proxy`, `g service`. Generated code must use typed validators and ownership cleanup.

## Security tests

SSRF/redirect/DNS cases, unsafe URL schemes, header leaks, cross-tenant cache isolation, cancelled requests and late results, duplicate mutations, retry storms, timeouts, replay/idempotency, streaming termination and error redaction.
