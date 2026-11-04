import { abortError, assertActive, awaitActive, createOperation } from "./cancellation.js";
import { HttpError, classifyFailure, configError } from "./errors.js";
import { interceptorList } from "./interceptors.js";
import { normalizeRetry, retryAllowed, canRetry, waitRetry } from "./retry.js";
import { parseResponse, replayable, serializeBody } from "./serialization.js";
import { originPolicy, resolveUrl } from "./url.js";
import type {
  AuthAdapter, ClientOptions, HttpClient, HttpMethod, HttpRequestContext, HttpResponse,
  Options, QueryParams, RequestOptions, Validator
} from "./types.js";

const methods = new Set<HttpMethod>(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]);
const secretHeaders = ["authorization", "cookie", "proxy-authorization", "x-api-key"];
function positive(value: number | undefined, name: string): void {
  if (value !== undefined && (!Number.isSafeInteger(value) || value <= 0))
    throw configError(name + " must be a positive integer");
}
function validateResponseSize(value: number | undefined): void {
  positive(value, "maxResponseBytes");
}
function authHeader(headers: Headers): boolean {
  return secretHeaders.some(header => headers.has(header));
}
function normalizeContext(input: HttpRequestContext, signal: AbortSignal, baseOrigin: string,
  allowed: ReadonlySet<string>): HttpRequestContext {
  if (input.signal !== signal) throw configError("Interceptors cannot replace an operation signal");
  if (!methods.has(input.method)) throw configError("Unsupported HTTP method");
  if (!(input.url instanceof URL)) throw configError("Request URL must be a URL");
  const url = resolveUrl(input.url.href, new URL(baseOrigin), allowed);
  if (input.redirect !== "manual" && input.redirect !== "error")
    throw configError("Automatic HTTP redirects are disabled for credential safety");
  if (input.method === "GET" || input.method === "HEAD") {
    if (input.body !== null) throw configError("GET and HEAD must not include a body");
  }
  if (input.credentials !== "omit" && input.credentials !== "same-origin" && input.credentials !== "include")
    throw configError("Invalid request credentials policy");
  if (url.origin !== baseOrigin) {
    if (input.credentials !== "omit" || authHeader(input.headers))
      throw configError("Credentials and sensitive headers cannot be sent to another origin");
  }
  return { ...input, url, headers: new Headers(input.headers) };
}
async function validate<T>(validator: Validator<T> | undefined, value: unknown,
  phase: "REQUEST_VALIDATION" | "RESPONSE_VALIDATION", signal: AbortSignal): Promise<T> {
  if (!validator) return value as T;
  try { return await awaitActive(Promise.resolve().then(() => validator.parse(value)), signal); }
  catch (cause) {
    if (signal.aborted) throw abortError(signal);
    throw new HttpError(phase, phase === "REQUEST_VALIDATION" ? "Request schema validation failed" : "Response schema validation failed",
      undefined, { cause });
  }
}
function refreshAllowed(method: HttpMethod, key?: string): boolean {
  return method === "GET" || method === "HEAD" || method === "OPTIONS" || (typeof key === "string" && key.length > 0);
}

/**
 * All interceptor lists execute in registration order. Requests execute once per logical
 * operation, responses once after successful parsing, and error interceptors once
 * after final failure. Retries repeat only the physical Fetch.
 */
export function createHttpClient(options: ClientOptions): HttpClient {
  if (!options || typeof options.baseURL !== "string") throw configError("baseURL is required");
  const { base, allowed } = originPolicy(options.baseURL, options.allowedOrigins);
  positive(options.timeoutMs, "timeoutMs");
  validateResponseSize(options.maxResponseBytes);
  const defaultRetry = normalizeRetry(options.retry);
  const transport = options.fetch ?? globalThis.fetch;
  if (typeof transport !== "function") throw configError("Fetch transport is unavailable");
  const baseOrigin = base.origin;
  const requests = interceptorList<import("./types.js").RequestInterceptor>();
  const responses = interceptorList<import("./types.js").ResponseInterceptor>();
  const errors = interceptorList<import("./types.js").ErrorInterceptor>();
  const active = new Set<ReturnType<typeof createOperation>>();
  let disposed = false;
  let refreshPromise: Promise<string | undefined> | undefined;
  let refreshOperation: ReturnType<typeof createOperation> | undefined;

  async function refresh(adapter: AuthAdapter, signal: AbortSignal): Promise<string | undefined> {
    if (!adapter.refreshToken) return undefined;
    if (!refreshPromise) {
      // A shared refresh has its own timeout/cancellation lifetime independent of callers.
      // Each caller can stop waiting without aborting the refresh needed by other callers.
      const operation = createOperation(undefined, options.timeoutMs ?? 10000);
      refreshOperation = operation;
      refreshPromise = awaitActive(
        Promise.resolve().then(() => adapter.refreshToken!({ signal: operation.signal })),
        operation.signal
      ).finally(() => {
        operation.dispose();
        if (refreshOperation === operation) refreshOperation = undefined;
        refreshPromise = undefined;
      });
    }
    return awaitActive(refreshPromise, signal);
  }
  async function detailed<T, B, Q extends QueryParams>(request: RequestOptions<T, B, Q>): Promise<HttpResponse<T>> {
    if (disposed) throw new HttpError("DISPOSED", "HTTP client has been disposed");
    if (!request || !methods.has(request.method)) throw configError("Invalid HTTP request method");
    const policy = request.retry === undefined ? defaultRetry : normalizeRetry(request.retry);
    const maxBytes = request.maxResponseBytes ?? options.maxResponseBytes ?? 10 * 1024 * 1024;
    validateResponseSize(maxBytes);
    if (request.idempotencyKey !== undefined && (!request.idempotencyKey || /[\r\n]/.test(request.idempotencyKey)))
      throw configError("Invalid idempotency key");
    // A retry elapsed deadline is an end-to-end ceiling, not merely a backoff budget.
    // Even an uncooperative first Fetch attempt must settle by this deadline.
    const configuredTimeout = request.timeoutMs ?? options.timeoutMs;
    const deadline = policy.maxAttempts > 1 ? policy.maxElapsedMs : undefined;
    const effectiveTimeout = deadline === undefined ? configuredTimeout :
      Math.min(configuredTimeout ?? deadline, deadline);
    const operation = createOperation(request.signal, effectiveTimeout);
    active.add(operation);
    try {
      const signal = operation.signal;
      assertActive(signal);
      const url = resolveUrl(request.url, base, allowed, request.query);
      const headers = new Headers(options.headers);
      new Headers(request.headers).forEach((value, name) => headers.set(name, value));
      if (request.idempotencyKey) headers.set("idempotency-key", request.idempotencyKey);
      const body = request.body === undefined ? undefined :
        await validate(request.requestSchema, request.body, "REQUEST_VALIDATION", signal);
      let ctx: HttpRequestContext = {
        method: request.method, url, headers, body: serializeBody(body, headers),
        credentials: request.credentials ?? options.credentials ?? "same-origin",
        redirect: request.redirect ?? "error", signal
      };
      ctx = normalizeContext(ctx, signal, baseOrigin, allowed);
      let shortCircuit: Response | undefined;
      for (const handler of requests.handlers()) {
        assertActive(signal);
        const result = await awaitActive(Promise.resolve().then(() => handler(ctx)), signal);
        if (result instanceof Response) { shortCircuit = result; break; }
        if (result) ctx = result;
        ctx = normalizeContext(ctx, signal, baseOrigin, allowed);
      }
      assertActive(signal);
      // The wire-level key must match the key authorized for mutation retry.
      // An interceptor must not silently strip or replace server idempotency protection.
      if (request.idempotencyKey !== undefined &&
          ctx.headers.get("idempotency-key") !== request.idempotencyKey)
        throw configError("Interceptors cannot change the configured idempotency key");
      if (ctx.body && !replayable(ctx.body) && (policy.maxAttempts > 1 || (options.auth?.refreshToken && request.auth !== false)))
        throw configError("Streaming request bodies cannot be replayed");
      if (!retryAllowed(ctx.method, policy, request.idempotencyKey) && policy.maxAttempts > 1)
        throw configError("Mutation retry requires allowUnsafeMethods and an idempotency key");
      let bearer: string | undefined;
      if (request.auth !== false && options.auth && ctx.url.origin === baseOrigin) {
        bearer = await awaitActive(Promise.resolve().then(() => options.auth!.getToken({ signal })), signal);
      }
      let httpResponse: HttpResponse<unknown> | undefined;
      let terminal: HttpError | undefined;
      let retryAfter: string | null = null;
      const started = Date.now();
      let refreshed = false;
      const attempts = shortCircuit ? 1 : policy.maxAttempts;
      for (let attempt = 1; attempt <= attempts; attempt++) {
        assertActive(signal);
        retryAfter = null;
        try {
          const attemptHeaders = new Headers(ctx.headers);
          if (bearer !== undefined) {
            if (!bearer.trim() || /[\r\n]/.test(bearer)) throw configError("Invalid bearer token");
            attemptHeaders.set("authorization", "Bearer " + bearer);
          }
          const init: RequestInit = {
            method: ctx.method, headers: attemptHeaders, body: ctx.body, credentials: ctx.credentials,
            redirect: ctx.redirect, signal
          };
          // Node's native Fetch requires duplex: half for ReadableStream uploads.
          if (ctx.body instanceof ReadableStream) Object.assign(init, { duplex: "half" });
          const response = shortCircuit ?? await awaitActive(
            Promise.resolve().then(() => transport(ctx.url, init)), signal
          );
          assertActive(signal);
          if (!(response instanceof Response)) throw new HttpError("UNSUPPORTED", "Transport returned a non-Response value");
          if (!response.ok) {
            // Close failed response bodies before refresh/retry to avoid retaining sockets.
            void response.body?.cancel().catch(() => {});
            if (response.status === 401 && !refreshed && options.auth?.refreshToken &&
                request.auth !== false && ctx.url.origin === baseOrigin &&
                refreshAllowed(ctx.method, request.idempotencyKey) && replayable(ctx.body)) {
              refreshed = true;
              try {
                const currentToken = await awaitActive(
                  Promise.resolve().then(() => options.auth!.getToken({ signal })), signal
                );
                bearer = currentToken && currentToken !== bearer ? currentToken : await refresh(options.auth, signal);
              } catch (cause) {
                if (signal.aborted) throw abortError(signal);
                // A refresh failure followed a 401: do not misclassify it as a
                // recoverable/retryable NETWORK failure.
                if (cause instanceof HttpError &&
                    (cause.code === "TIMEOUT" || cause.code === "CANCELLED" || cause.code === "DISPOSED")) {
                  throw cause;
                }
                throw new HttpError("HTTP_STATUS", "HTTP authentication failed with status 401", 401, { cause });
              }
              if (bearer) {
                attempt--; // one bounded auth refresh, not counted as a retry attempt.
                continue;
              }
            }
            retryAfter = response.headers.get("retry-after");
            throw new HttpError("HTTP_STATUS", "HTTP request failed with status " + response.status, response.status);
          }
          const raw = ctx.method === "HEAD" ? null :
            await awaitActive(parseResponse(response, request.responseType ?? "auto", maxBytes, signal), signal);
          httpResponse = { data: raw, status: response.status, headers: response.headers, url: response.url || ctx.url.href };
          terminal = undefined;
          break;
        } catch (cause) {
          const failure = signal.aborted ? abortError(signal) : classifyFailure(cause);
          terminal = failure;
          if (attempt >= attempts || !retryAllowed(ctx.method, policy, request.idempotencyKey) ||
              !replayable(ctx.body) || !canRetry(failure, policy)) break;
          if (!await waitRetry(attempt, policy, signal, started, retryAfter)) break;
        }
      }
      if (!httpResponse) {
        const failure = terminal ?? new HttpError("NETWORK", "HTTP request did not return a response");
        // Never allow interception to convert cancellation, timeout, parsing,
        // validation, unsafe URL or configuration failures into success.
        for (const handler of errors.handlers()) {
          assertActive(signal);
          const recovery = await awaitActive(Promise.resolve().then(() => handler(failure)), signal);
          if (recovery && recovery.recovered &&
              (failure.code === "NETWORK" ||
               (failure.code === "HTTP_STATUS" && failure.status !== 401 && failure.status !== 403))) {
            httpResponse = recovery.value;
            break;
          }
        }
        if (!httpResponse) throw failure;
      }
      let result: HttpResponse<unknown> = httpResponse;
      for (const handler of responses.handlers()) {
        assertActive(signal);
        result = await awaitActive(Promise.resolve().then(() => handler(result)), signal);
        if (!result || typeof result.status !== "number" || !(result.headers instanceof Headers))
          throw new HttpError("UNSUPPORTED", "Response interceptor returned invalid metadata");
      }
      assertActive(signal);
      const data = await validate(request.responseSchema, result.data, "RESPONSE_VALIDATION", signal);
      return { ...result, data };
    } finally {
      operation.dispose();
      active.delete(operation);
    }
  }
  const client: HttpClient = {
    interceptors: { request: requests, response: responses, error: errors },
    request: async <T, B, Q extends QueryParams>(request: RequestOptions<T, B, Q>) =>
      (await detailed(request)).data,
    requestDetailed: detailed,
    get: <T, Q extends QueryParams>(url: string, opt?: Options<T, never, Q>) =>
      client.request<T, never, Q>({ ...opt, method: "GET", url }),
    delete: <T, Q extends QueryParams>(url: string, opt?: Options<T, never, Q>) =>
      client.request<T, never, Q>({ ...opt, method: "DELETE", url }),
    post: <T, B, Q extends QueryParams>(url: string, body?: B, opt?: Options<T, B, Q>) =>
      client.request<T, B, Q>({ ...opt, method: "POST", url, body }),
    put: <T, B, Q extends QueryParams>(url: string, body?: B, opt?: Options<T, B, Q>) =>
      client.request<T, B, Q>({ ...opt, method: "PUT", url, body }),
    patch: <T, B, Q extends QueryParams>(url: string, body?: B, opt?: Options<T, B, Q>) =>
      client.request<T, B, Q>({ ...opt, method: "PATCH", url, body }),
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const operation of active) operation.abort(new HttpError("DISPOSED", "HTTP client has been disposed"));
      active.clear();
      refreshOperation?.abort(new HttpError("DISPOSED", "HTTP client has been disposed"));
      requests.clear(); responses.clear(); errors.clear();
    }
  };
  return client;
}
