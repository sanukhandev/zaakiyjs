---
title: "@zaakiyjs/http"
description: "Typed Fetch client, interceptors, origin policies, AbortSignal and bounded retries"
sidebar_position: 12
---

# @zaakiyjs/http

Use HTTP inside repository/service implementations; keep view and reactive concerns in Store/Async/Forms.

> **Availability:** Source implementation in ZaakiyJS, not a verified published npm release. The package's manifest at the referenced revision uses `0.0.0`; use workspace tooling until independent publishing is approved.

## At a glance

- **Use it when:** Create a per-app/service client with a trusted `baseURL`, attach validation and pass cancellation signals.
- **Reference revision:** [9f6c6603c98c](https://github.com/sanukhandev/zaakiyjs/commit/9f6c6603c98ca566c2fed6fed34cc770f6a72960).

## Try it in the monorepo

```sh
pnpm --filter @zaakiyjs/http typecheck
pnpm --filter @zaakiyjs/http test
pnpm --filter @zaakiyjs/http build
```

## Feature usage: first working pattern

```ts
import { createHttpClient } from '@zaakiyjs/http';

interface Profile { id: string; displayName: string }
const http = createHttpClient({ baseURL: '/api/', timeoutMs: 8_000 });
const remove = http.interceptors.request.use(ctx => {
  ctx.headers.set('x-client', 'zaakiy-app');
});
const profile = await http.get<Profile>('/profile');
console.log(profile.displayName);
remove();
http.dispose();
```

TypeScript generics are static only: use a runtime `responseSchema.parse()` validator when response trust matters.

## Usage and correctness guidelines

- Never serialize raw HttpError causes or log Authorization/Cookie values.
- Cross-origin requests are restricted; @zaakiyjs/http is not an SSRF boundary.
- Write retries need a server-enforced idempotency key; avoid duplicate retry loops in Async and HTTP.

## Public API index

Exported symbols detected in the package root `src/index.ts`. Platform-specific subpaths and structural contracts are explained in the detailed guide and package manifest.

- `AuthAdapter`
- `ClientOptions`
- `ErrorInterceptor`
- `HttpClient`
- `HttpError`
- `HttpErrorCode`
- `HttpInterceptors`
- `HttpMethod`
- `HttpRecovery`
- `HttpRequestContext`
- `HttpResponse`
- `InterceptorList`
- `QueryParams`
- `QueryValue`
- `RequestInterceptor`
- `RequestOptions`
- `ResponseInterceptor`
- `ResponseType`
- `RetryPolicy`
- `Validator`
- `createHttpClient`
- `isHttpError`

## Detailed feature guide

### Usage

    import { createHttpClient } from "@zaakiyjs/http";
    const http = createHttpClient({ baseURL: "/api/", timeoutMs: 10_000 });
    interface User { id: number; email: string }
    const user = await http.get<User>("/users/101");
    await http.post<User, { email: string }>("/users", { email: "ada@example.test" });

The shorthand methods return parsed data; requestDetailed returns data, status, headers and URL metadata. Generic type arguments do NOT validate runtime responses. Supply requestSchema or responseSchema with an object providing parse(value) for runtime validation, including Zod-compatible implementations.

Body support: JSON, text, FormData, URLSearchParams, Blob, ArrayBuffer and ReadableStream. Client-level default headers are merged case-insensitively with per-request overrides; native Node ReadableStream uploads use duplex: half. Parsing: JSON, text, empty 204/205, blob, arrayBuffer and explicitly requested stream. Default parsed-response byte limit: 10 MiB; raw streams bypass that limit and require caller-managed consumption/cancellation. A JSON empty body produces null.

### Interceptors

    const remove = http.interceptors.request.use(ctx => {
      ctx.headers.set("x-correlation-id", "request-id");
    });
    http.interceptors.response.use(response => response);
    http.interceptors.error.use(error => { /* logging must be redacted */ });
    remove();

Handlers run FIFO, with duplicate registration ignored per client. Requests run once per logical operation; retries repeat only Fetch. Request interceptors can short-circuit by returning a Response. Response interceptors operate on parsed response objects; error interceptors can explicitly recover only terminal NETWORK or HTTP_STATUS failures. Request and response interceptor exceptions propagate to the caller and are not passed through the error pipeline in this revision. A response validator runs once on final transformed data, including authorized interceptor recovery.

### Security

Requests are confined to the base origin, unless an additional origin is explicitly allowlisted. Cross-origin calls require credentials: omit and cannot carry Authorization, Cookie, X-API-Key or Proxy-Authorization headers. A bearer auth provider runs only for the base origin. A single-flight optional refreshToken handler handles one 401 per logical request, but only for read methods or writes with a server-enforced idempotency key. Its timeout is classified as TIMEOUT and does not force-cancel other clients waiting for the same refresh. Explicit recovery and retry policies cannot turn HTTP 401/403 authorization failures into successful responses or retry them automatically. Failed token refresh preserves the original 401 (and cause) instead of becoming a recoverable NETWORK error; explicit refresh timeouts and cancellations retain their own classifications. No tokens are stored by this package. Interceptors may not replace or remove the idempotency key selected by the caller when mutation retry is enabled. Do not log credentials or opaque underlying exception causes.

Automatic redirects are forbidden (redirect: error by default). Manual redirects are supported without following them. Caller and interceptor URL changes are revalidated against allowed protocols and origins. This client is NOT an SSRF barrier; implement egress and DNS policies inside the server-only @zaakiyjs/proxy. Cookie-based write endpoints require server CSRF protection.

### Cancellation/retries

An AbortSignal can come from an AbortController, @zaakiyjs/async resource, task, or route scope. Request timeout overrides client timeout and covers interceptors, transport, parsing and retry wait. Cancel/timeout are separate HttpError codes. Client.dispose cancels in-flight logical requests and permanently disables client use. Cancellation of a write does not imply remote rollback.

Retry defaults OFF (maxAttempts: 1). Explicit bounded 1-10 attempt retries support exponential backoff, optional jitter and Retry-After, with network and selected 408/429/5xx codes eligible. Jitter never decreases the server-mandated Retry-After minimum. When retries are enabled, maxElapsedMs is an end-to-end deadline (including a stalled initial attempt); the smaller of this and the request timeout wins. GET/HEAD/OPTIONS may retry. POST/PUT/PATCH/DELETE additionally require allowUnsafeMethods: true and idempotencyKey, plus genuine server idempotency. Non-replayable streaming request bodies cannot retry. Avoid configuring two independent retry layers in HTTP and @zaakiyjs/async.

Structured HttpError codes: HTTP_STATUS, NETWORK, TIMEOUT, CANCELLED, REQUEST_VALIDATION, RESPONSE_VALIDATION, PARSE, UNSUPPORTED, INVALID_CONFIG, DISPOSED. Safe messages omit body and credential contents; error.cause can contain sensitive upstream details and must not be serialized blindly.

Node requires an absolute base URL; relative base URLs resolve using browser location. No global HTTP singleton, alternate Promise, reactive state engine, cache or owner tracking is provided.

The HTTP package is present in the current workspace. Validate current CI and package artifacts for each change; independent npm publication requires separate release approval.

## Integrate with neighboring packages

- [@zaakiyjs/async](./async.md)
- [@zaakiyjs/forms](./forms.md)
- [@zaakiyjs/proxy](./proxy.md)
- [@zaakiyjs/router](./router.md)

## Source and maintenance

- [Package README](https://github.com/sanukhandev/zaakiyjs/blob/9f6c6603c98ca566c2fed6fed34cc770f6a72960/packages/http/README.md)
- [Public source exports](https://github.com/sanukhandev/zaakiyjs/blob/9f6c6603c98ca566c2fed6fed34cc770f6a72960/packages/http/src/index.ts)
- [Package test cases](https://github.com/sanukhandev/zaakiyjs/tree/9f6c6603c98ca566c2fed6fed34cc770f6a72960/packages/http/test)
- Update this page when public APIs, runtime semantics or platform guarantees change.
