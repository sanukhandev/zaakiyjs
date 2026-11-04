# @zaakiyjs/http

Native Fetch-based typed HTTP transport for Node.js 22+ and modern browsers. This package has no React, Vue, Angular, Proxy, Signals, Axios, Zone.js, or AI runtime dependency. ViewModels should consume this through repository interfaces and delegate reactive loading to @zaakiyjs/async.

## Usage

    import { createHttpClient } from "@zaakiyjs/http";
    const http = createHttpClient({ baseURL: "/api/", timeoutMs: 10_000 });
    interface User { id: number; email: string }
    const user = await http.get<User>("/users/101");
    await http.post<User, { email: string }>("/users", { email: "ada@example.test" });

The shorthand methods return parsed data; requestDetailed returns data, status, headers and URL metadata. Generic type arguments do NOT validate runtime responses. Supply requestSchema or responseSchema with an object providing parse(value) for runtime validation, including Zod-compatible implementations.

Body support: JSON, text, FormData, URLSearchParams, Blob, ArrayBuffer and ReadableStream. Parsing: JSON, text, empty 204/205, blob, arrayBuffer and explicitly requested stream. Default parsed-response byte limit: 10 MiB; raw streams bypass that limit and require caller-managed consumption/cancellation. A JSON empty body produces null.

## Interceptors

    const remove = http.interceptors.request.use(ctx => {
      ctx.headers.set("x-correlation-id", "request-id");
    });
    http.interceptors.response.use(response => response);
    http.interceptors.error.use(error => { /* logging must be redacted */ });
    remove();

Handlers run FIFO, with duplicate registration ignored per client. Requests run once per logical operation; retries repeat only Fetch. Request interceptors can short-circuit by returning a Response. Response interceptors operate on parsed response objects; error interceptors can explicitly recover only terminal NETWORK or HTTP_STATUS failures. Request and response interceptor exceptions propagate to the caller and are not passed through the error pipeline in this revision.

## Security

Requests are confined to the base origin, unless an additional origin is explicitly allowlisted. Cross-origin calls require credentials: omit and cannot carry Authorization, Cookie, X-API-Key or Proxy-Authorization headers. A bearer auth provider runs only for the base origin. A single-flight optional refreshToken handler handles one 401 per logical request, but only for read methods or writes with a server-enforced idempotency key. No tokens are stored by this package. Do not log credentials or opaque underlying exception causes.

Automatic redirects are forbidden (redirect: error by default). Manual redirects are supported without following them. Caller and interceptor URL changes are revalidated against allowed protocols and origins. This client is NOT an SSRF barrier; implement egress and DNS policies inside the server-only @zaakiyjs/proxy. Cookie-based write endpoints require server CSRF protection.

## Cancellation/retries

An AbortSignal can come from an AbortController, @zaakiyjs/async resource, task, or route scope. Request timeout overrides client timeout and covers interceptors, transport, parsing and retry wait. Cancel/timeout are separate HttpError codes. Client.dispose cancels in-flight logical requests and permanently disables client use. Cancellation of a write does not imply remote rollback.

Retry defaults OFF (maxAttempts: 1). Explicit bounded 1-10 attempt retries support exponential backoff, optional jitter and Retry-After, with network and selected 408/429/5xx codes eligible. GET/HEAD/OPTIONS may retry. POST/PUT/PATCH/DELETE additionally require allowUnsafeMethods: true and idempotencyKey, plus genuine server idempotency. Non-replayable streaming request bodies cannot retry. Avoid configuring two independent retry layers in HTTP and @zaakiyjs/async.

Structured HttpError codes: HTTP_STATUS, NETWORK, TIMEOUT, CANCELLED, REQUEST_VALIDATION, RESPONSE_VALIDATION, PARSE, UNSUPPORTED, INVALID_CONFIG, DISPOSED. Safe messages omit body and credential contents; error.cause can contain sensitive upstream details and must not be serialized blindly.

Node requires an absolute base URL; relative base URLs resolve using browser location. No global HTTP singleton, alternate Promise, reactive state engine, cache or owner tracking is provided.

Before merging this feature, an integrator must update the root workspace verifier allowlist to recognize the new HTTP package and regenerate pnpm-lock.yaml. NET-01 forbids editing root scripts in this isolated branch; therefore the PR remains draft until integration validation passes.
