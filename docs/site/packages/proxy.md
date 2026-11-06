---
title: "@zaakiyjs/proxy"
description: "Server-only named-upstream gateway, authorization, rate limits and SSRF defense"
sidebar_position: 13
---

# @zaakiyjs/proxy

Use Proxy in Node server entrypoints only, never in browser bundles.

> **Availability:** Source implementation in ZaakiyJS, not a verified published npm release. The package's manifest at the referenced revision uses `0.0.0`; use workspace tooling until independent publishing is approved.

## At a glance

- **Use it when:** Declare trusted upstream origins and exact route policies in server code; never construct origins from client request parameters.
- **Reference revision:** [9f6c6603c98c](https://github.com/sanukhandev/zaakiyjs/commit/9f6c6603c98ca566c2fed6fed34cc770f6a72960).

## Try it in the monorepo

```sh
pnpm --filter @zaakiyjs/proxy typecheck
pnpm --filter @zaakiyjs/proxy test
pnpm --filter @zaakiyjs/proxy build
```

## Feature usage: first working pattern

```ts
import { createServer } from 'node:http';
import { createProxyRouter, createNodeHttpHandler } from '@zaakiyjs/proxy';

const gateway = createProxyRouter({
  upstreams: { catalog: { origin: 'https://catalog.example.test' } },
  authenticate: async ({ request }) => {
    // Replace with real trusted session verification.
    return verifySession(request.headers.cookie);
  },
  routes: [{
    id: 'catalog', path: '/api/catalog/*', upstream: 'catalog',
    methods: ['GET'], access: 'authenticated',
    authorize: ({ principal }) => principal.permissions?.includes('catalog:read') === true
  }]
});
createServer(createNodeHttpHandler(gateway)).listen(8080);
```

`verifySession` is application-defined, not a framework export.

## Usage and correctness guidelines

- Only reviewed named HTTP(S) upstreams are accepted; DNS answers are checked and pinned for connections.
- Multi-instance rate limiting requires a shared atomic store rather than `MemoryRateLimitStore`.
- Edge/Workers and browser environments are not supported by this Node DNS/socket implementation.

## Public API index

Exported symbols detected in the package root `src/index.ts`. Platform-specific subpaths and structural contracts are explained in the detailed guide and package manifest.

- `AddressResolver`
- `AuthenticationContext`
- `Authenticator`
- `AuthorizationContext`
- `Authorizer`
- `LookupAddress`
- `MemoryRateLimitStore`
- `ProxyAccess`
- `ProxyBody`
- `ProxyConfig`
- `ProxyConfigurationError`
- `ProxyDiagnostic`
- `ProxyHooks`
- `ProxyIncoming`
- `ProxyOutgoing`
- `ProxyPayloadError`
- `ProxyPolicyError`
- `ProxyPrincipal`
- `ProxyRateLimit`
- `ProxyRoute`
- `ProxyRouter`
- `ProxyTimeoutError`
- `ProxyUpstream`
- `ProxyUpstreamError`
- `RateLimitDecision`
- `RateLimitInput`
- `RateLimitStore`
- `RequestValidator`
- `ValidatedRequestContext`
- `allowedAddress`
- `createNodeHttpHandler`
- `createProxyRouter`

## Detailed feature guide

### Usage (Node 22+)

```ts
import { createServer } from "node:http";
import { createProxyRouter, createNodeHttpHandler } from "@zaakiyjs/proxy";

const router = createProxyRouter({
  upstreams: {
    catalog: { origin: process.env.CATALOG_API_URL! }
  },
  authenticate: async ({ request }) => {
    // Verify sessions or signed bearer tokens with your trusted service.
    return verifySession(request.headers.cookie); // application-supplied
  },
  routes: [{
    id: "catalog-read",
    path: "/api/catalog/*",
    upstream: "catalog",
    methods: ["GET"],
    access: "authenticated",
    authorize: ({ principal }) => principal.permissions?.includes("catalog:read") === true,
    rateLimit: { by: "principal", max: 100, windowMs: 60_000 }
  }]
});

createServer(createNodeHttpHandler(router)).listen(8080);
```

`verifySession` is application code, not a library export. Every protected route must have an authenticator and an authorizer. Public routes declare `access: "public"` explicitly; a missing route always rejects.

### Security and request flow

```text
Node HTTP adapter -> strict URL/method normalization -> unique route
 -> trusted authentication -> request-scoped authorization -> rate limiting
 -> validator -> non-overriding hooks -> upstream credentials
 -> DNS answer policy -> pinned-IP Node HTTP(S) connection
 -> bounded response -> allowlisted response headers -> adapter
```

Only configured HTTP(S) origins are accepted. HTTPS is the default. HTTP requires `allowInsecureHttp: true`. Private addresses require exact `allowedPrivateAddresses` entries. Every DNS answer is checked and Node's socket lookup is pinned to the validated IP, with the approved hostname retained for TLS/SNI and certificate validation (`agent: false`). There is no second DNS lookup after security validation. Automatic redirects are not followed. TLS verification cannot be disabled by config. Production must additionally enforce restricted outbound egress, including cloud metadata endpoint blocking.

**Trust boundary:** Upstream configuration, custom resolver, credentials, authenticators, and policy functions must come exclusively from trusted server code. Caller parameters cannot choose an origin. An explicit allowed private address is an administrative security exception; never derive it from HTTP input. The injected resolver is for controlled tests/deployments: all its answers still pass the production transport's IP policy.

#### Forwarding

- Default incoming allowlist: Accept, Accept-Language, Content-Type, Content-Encoding, conditional request headers, Range, User-Agent.
- Default outgoing allowlist: Content-Type, Content-Encoding, ETag, Last-Modified, Content-Range, Accept-Ranges, Content-Disposition.
- Host, Connection/hop-by-hop, X-Forwarded-*, Forwarded, Cookie, incoming Authorization, Set-Cookie, Location and secret headers are stripped. Sensitive auth credentials must be created by the upstream's server-only `credentials()` hook.
- Only exact, trailing `/*` prefix and single-segment `:param` patterns are supported. Same-method overlaps are rejected on startup to prevent route shadowing.
- Request bodies and responses are streamed with backpressure and hard byte caps. Once downstream response headers have been sent, an overflow terminates the stream rather than rewriting an HTTP status.
- Per-request timeout and client disconnect propagate through native AbortSignal; cancellation does not roll back mutations. Retry is off by default and can be enabled only for bodyless GET/HEAD, up to two additional attempts within the same deadline.
- `MemoryRateLimitStore` has bounded, single-process memory; it is **not distributed**. Multi-instance deployments require a shared atomic `RateLimitStore` or managed gateway limiter. The Node adapter uses only the peer socket address, not X-Forwarded-For.
- Diagnostics contain only generated request ID, named route/upstream, coarse category, status and duration. Tokens, cookies, body data and upstream credentials are never logged by the package.

#### Limitations and deployment support

| Environment | Status |
| --- | --- |
| Node.js 22+ native HTTP server | Implemented |
| Fastify/Express | Node adapter can be integrated; specialized wrappers not yet tested |
| Node-based serverless | Host-specific lifecycle validation required |
| Edge/Workers | Not supported (Node DNS/sockets required) |
| Browser | No browser export |

No WebSocket proxy, automatic redirects, forwarded-client-IP chain, distributed circuit breaker or cache is provided. Streaming abort races, full adversarial SSRF matrix, externally installed tarball and production egress policy still require review before release.

## Integrate with neighboring packages

- [@zaakiyjs/http](./http.md)
- [@zaakiyjs/router](./router.md)
- [@zaakiyjs/ssr](./ssr.md)
- [@zaakiyjs/consent](./consent.md)

## Source and maintenance

- [Package README](https://github.com/sanukhandev/zaakiyjs/blob/9f6c6603c98ca566c2fed6fed34cc770f6a72960/packages/proxy/README.md)
- [Public source exports](https://github.com/sanukhandev/zaakiyjs/blob/9f6c6603c98ca566c2fed6fed34cc770f6a72960/packages/proxy/src/index.ts)
- [Package test cases](https://github.com/sanukhandev/zaakiyjs/tree/9f6c6603c98ca566c2fed6fed34cc770f6a72960/packages/proxy/test)
- Update this page when public APIs, runtime semantics or platform guarantees change.
