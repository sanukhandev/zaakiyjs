/** Server-only API gateway. Never import from browser application code. */
import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { once } from "node:events";
import { assertCount, assertMethod, cleanOrigin, compileRoutes, incomingURL, ProxyConfigurationError, ProxyPayloadError, ProxyPolicyError, ProxyTimeoutError, ProxyUpstreamError, requestHeaders, safeCredentialHeaders } from "./security.js";
import { defaultResolver, dispatch } from "./transport.js";
import type { ProxyConfig, ProxyIncoming, ProxyOutgoing, ProxyPrincipal, ProxyRouter, RateLimitDecision, RateLimitInput, RateLimitStore, ValidatedRequestContext } from "./types.js";
export type { ProxyConfig, ProxyIncoming, ProxyOutgoing, ProxyBody, ProxyPrincipal, ProxyRouter, ProxyRoute, ProxyUpstream, ProxyAccess, ProxyRateLimit, RateLimitStore, RateLimitDecision, RateLimitInput, ProxyDiagnostic, AuthenticationContext, Authenticator, Authorizer, AuthorizationContext, AddressResolver, LookupAddress, ProxyHooks, RequestValidator, ValidatedRequestContext } from "./types.js";
export { ProxyConfigurationError, ProxyPayloadError, ProxyPolicyError, ProxyTimeoutError, ProxyUpstreamError, allowedAddress } from "./security.js";

const jsonHeaders = Object.freeze({ "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" });
const safeResponse = (status: number, code: string, extra?: Record<string, string>): ProxyOutgoing => ({
  status, headers: { ...jsonHeaders, ...extra },
  body: (async function* () { yield Buffer.from(JSON.stringify({ error: code })); })()
});
export class MemoryRateLimitStore implements RateLimitStore {
  private readonly entries = new Map<string, { count: number; expires: number }>();
  constructor(private readonly maxKeys = 10_000) {
    assertCount(maxKeys, 10_000, "maxKeys", 1_000_000);
  }
  check({ key, max, windowMs, now }: RateLimitInput): RateLimitDecision {
    let item = this.entries.get(key);
    if (item && now >= item.expires) { this.entries.delete(key); item = undefined; }
    if (!item) {
      if (this.entries.size >= this.maxKeys) {
        for (const [id, entry] of this.entries) if (now >= entry.expires) this.entries.delete(id);
      }
      if (this.entries.size >= this.maxKeys) throw new ProxyPolicyError("Rate-limit store at capacity");
      item = { count: 0, expires: now + windowMs };
      this.entries.set(key, item);
    }
    item.count++;
    return item.count <= max ? { allowed: true } : { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((item.expires - now) / 1_000)) };
  }
}

export function createProxyRouter(config: ProxyConfig): ProxyRouter {
  if (!config || !config.upstreams || typeof config.upstreams !== "object") throw new ProxyConfigurationError("Missing upstream configuration");
  const compiledUpstreams = new Map<string, { origin: URL; upstream: NonNullable<ProxyConfig["upstreams"][string]> }>();
  const upstreamSnapshots: Record<string, NonNullable<ProxyConfig["upstreams"][string]>> = Object.create(null) as Record<string, NonNullable<ProxyConfig["upstreams"][string]>>;
  for (const [id, upstream] of Object.entries(config.upstreams)) {
    if (!/^[a-z][a-z0-9_-]*$/.test(id) || !upstream) throw new ProxyConfigurationError("Invalid upstream ID");
    const approved = Object.freeze({ ...upstream,
      allowedPrivateAddresses: upstream.allowedPrivateAddresses ? Object.freeze([...upstream.allowedPrivateAddresses]) : undefined
    });
    upstreamSnapshots[id] = approved;
    compiledUpstreams.set(id, { origin: cleanOrigin(approved), upstream: approved });
  }
  if (!Array.isArray(config.routes)) throw new ProxyConfigurationError("Missing route configuration");
  const routeSnapshots = config.routes.map(route => {
    if (!route || !Array.isArray(route.methods)) throw new ProxyConfigurationError("Invalid route configuration");
    return Object.freeze({ ...route,
      methods: Object.freeze([...route.methods]),
      requestHeaders: route.requestHeaders ? Object.freeze([...route.requestHeaders]) : undefined,
      responseHeaders: route.responseHeaders ? Object.freeze([...route.responseHeaders]) : undefined,
      rateLimit: route.rateLimit ? Object.freeze({ ...route.rateLimit }) : undefined,
      retry: route.retry ? Object.freeze({ ...route.retry }) : undefined,
      hooks: route.hooks ? Object.freeze({ ...route.hooks }) : undefined
    });
  });
  const routes = compileRoutes(routeSnapshots, upstreamSnapshots);
  const authenticator = config.authenticate;
  if (routes.some(r => r.route.access === "authenticated") && !authenticator) throw new ProxyConfigurationError("Protected routes require an authenticator");
  const limiter = config.rateLimitStore ?? new MemoryRateLimitStore();
  const resolver = config.resolver ?? defaultResolver;
  const abortable = <T>(operation: Promise<T> | T, signal: AbortSignal): Promise<T> => {
    if (signal.aborted) return Promise.reject(signal.reason);
    return new Promise<T>((resolve, reject) => {
      const aborted = (): void => { signal.removeEventListener("abort", aborted); reject(signal.reason); };
      signal.addEventListener("abort", aborted, { once: true });
      Promise.resolve(operation).then(value => { signal.removeEventListener("abort", aborted); resolve(value); }, reason => { signal.removeEventListener("abort", aborted); reject(reason); });
      if (signal.aborted) aborted();
    });
  };
  return {
    async handle(request: ProxyIncoming): Promise<ProxyOutgoing> {
      const started = Date.now(); const requestId = randomUUID();
      let category: Parameters<NonNullable<ProxyConfig["onDiagnostic"]>>[0]["category"] = "security";
      let status = 500;
      let routeId: string | undefined;
      let upstreamId: string | undefined;
      let cleanup = (): void => {};
      let reported = false;
      const report = (): void => {
        if (reported) return; reported = true;
        try { config.onDiagnostic?.({ requestId, routeId, upstreamId, category, status, durationMs: Date.now() - started }); } catch { /* diagnostics never control the response */ }
      };
      const finish = (response: ProxyOutgoing, kind: typeof category): ProxyOutgoing => {
        status = response.status; category = kind;
        if (!response.body) { cleanup(); report(); return response; }
        const body = response.body;
        let drained = false;
        return {
          ...response,
          body: (async function* () {
            try { for await (const chunk of body) yield chunk; drained = true; }
            finally { if (!drained) response.cancel?.(); cleanup(); report(); }
          })(),
          cancel: () => { response.cancel?.(); cleanup(); report(); }
        };
      };
      try {
        const method = assertMethod(request.method);
        // Body-bearing GET/HEAD requests are disallowed rather than silently
        // dropping unconsumed bytes at the HTTP adapter boundary.
        if (method === "GET" || method === "HEAD") {
          const length = request.headers["content-length"];
          if (request.body || request.headers["transfer-encoding"] !== undefined ||
              (length !== undefined && length !== "0")) {
            return finish(safeResponse(400, "BODY_NOT_ALLOWED"), "validation");
          }
        }
        const url = incomingURL(request.url);
        const path = url.pathname;
        const matches = routes.filter(item => item.regex.test(path));
        if (!matches.length) return finish(safeResponse(404, "NOT_FOUND"), "not_found");
        const found = matches.find(item => item.route.methods.includes(method));
        if (!found) return finish(safeResponse(405, "METHOD_NOT_ALLOWED", { allow: [...new Set(matches.flatMap(m => m.route.methods))].join(", ") }), "method");
        const { route, regex, params: paramNames } = found;
        routeId = route.id; upstreamId = route.upstream;
        const match = regex.exec(path);
        const params: Record<string, string> = Object.create(null) as Record<string, string>;
        for (let index = 0; index < paramNames.length; index++) params[paramNames[index]!] = decodeURIComponent(match?.[index + 1] ?? "");
        const target = compiledUpstreams.get(route.upstream)!;
        const timeout = Math.min(route.timeoutMs ?? 30_000, target.upstream.timeoutMs ?? 30_000);
        const controller = new AbortController();
        const cancelCaller = (): void => controller.abort(request.signal?.reason ?? new Error("Client closed"));
        if (request.signal?.aborted) cancelCaller();
        else request.signal?.addEventListener("abort", cancelCaller, { once: true });
        const timer = setTimeout(() => controller.abort(new ProxyTimeoutError()), timeout);
        let cleaned = false;
        cleanup = () => { if (cleaned) return; cleaned = true; clearTimeout(timer); request.signal?.removeEventListener("abort", cancelCaller); };
        const signal = controller.signal;
        if (signal.aborted) return finish(safeResponse(499, "CLIENT_CLOSED"), "cancelled");
        let principal: ProxyPrincipal | null = null;
        if (route.access === "authenticated") {
          try { principal = await abortable(authenticator!({ request, routeId: route.id, signal }), signal); } catch { if (signal.aborted) throw signal.reason; principal = null; }
          if (!principal?.subject || typeof principal.subject !== "string") return finish(safeResponse(401, "UNAUTHENTICATED"), "authn");
          try {
            const approved = await abortable(route.authorize!({ principal, routeId: route.id, params, method, signal }), signal);
            if (approved !== true) return finish(safeResponse(403, "FORBIDDEN"), "authz");
          } catch { if (signal.aborted) throw signal.reason; return finish(safeResponse(403, "FORBIDDEN"), "authz"); }
        }
        const ctx: ValidatedRequestContext = { routeId: route.id, params, principal, method, query: new URLSearchParams(url.search), signal };
        if (route.rateLimit) {
          const identity = route.rateLimit.by === "principal" ? principal?.subject : route.rateLimit.by === "tenant" ? principal?.tenantId : request.remoteAddress;
          if (!identity) return finish(safeResponse(403, "RATE_LIMIT_IDENTITY_REQUIRED"), "rate_limit");
          const key = JSON.stringify([route.id, route.rateLimit.by, identity]);
          let decision: RateLimitDecision;
          try { decision = await abortable(limiter.check({ key, max: route.rateLimit.max, windowMs: route.rateLimit.windowMs, now: Date.now() }), signal); }
          catch { if (signal.aborted) throw signal.reason; return finish(safeResponse(503, "RATE_LIMIT_UNAVAILABLE"), "rate_limit"); }
          if (!decision.allowed) return finish(safeResponse(429, "RATE_LIMITED", { "retry-after": String(decision.retryAfterSeconds ?? 1) }), "rate_limit");
        }
        if (route.validate) {
          try { if (await abortable(route.validate(ctx), signal) !== true) return finish(safeResponse(400, "VALIDATION_FAILED"), "validation"); }
          catch { if (signal.aborted) throw signal.reason; return finish(safeResponse(400, "VALIDATION_FAILED"), "validation"); }
        }
        try { await abortable(route.hooks?.beforeDispatch?.(ctx), signal); } catch { if (signal.aborted) throw signal.reason; return finish(safeResponse(403, "MIDDLEWARE_REJECTED"), "security"); }
        const declaredLength = request.headers["content-length"];
        const maxRequestBytes = route.maxRequestBytes ?? 1_048_576;
        if (Array.isArray(declaredLength) || (typeof declaredLength === "string" && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > maxRequestBytes))) {
          return finish(safeResponse(413, "REQUEST_TOO_LARGE"), "validation");
        }
        const headers = requestHeaders(request.headers, route.requestHeaders);
        if (target.upstream.credentials) {
          try { Object.assign(headers, safeCredentialHeaders(await abortable(target.upstream.credentials(ctx), signal))); }
          catch { if (signal.aborted) throw signal.reason; return finish(safeResponse(502, "UPSTREAM_CREDENTIALS_UNAVAILABLE"), "security"); }
        }
        const base = target.upstream.basePath ?? "";
        const fullPath = base.replace(/\/$/, "") + path + url.search;
        const attempts = route.retry?.attempts ?? 0;
        for (let attempt = 0; attempt <= attempts; attempt++) {
          if (signal.aborted) throw signal.reason;
          try {
            const response = await dispatch({ origin: target.origin, upstream: target.upstream, method,
              path: fullPath, requestHeaders: headers, responseHeaderAllowlist: route.responseHeaders,
              body: request.body, maxRequestBytes, signal, resolver });
            try { await abortable(route.hooks?.afterResponse?.(ctx, response.status), signal); }
            catch { response.cancel?.(); if (signal.aborted) throw signal.reason; return finish(safeResponse(502, "RESPONSE_POLICY_REJECTED"), "security"); }
            return finish(response, "success");
          } catch (error) {
            if (signal.aborted) throw signal.reason;
            if (error instanceof ProxyPolicyError) throw error;
            if (attempt >= attempts || !["GET", "HEAD"].includes(method) || request.body) throw error;
            await new Promise<void>((resolve, reject) => {
              const timer = setTimeout(() => { signal.removeEventListener("abort", onAbort); resolve(); }, 50 * (attempt + 1));
              const onAbort = (): void => { clearTimeout(timer); reject(signal.reason); };
              signal.addEventListener("abort", onAbort, { once: true });
              if (signal.aborted) onAbort();
            });
          }
        }
        throw new ProxyUpstreamError();
      } catch (error) {
        if (error instanceof ProxyPayloadError) return finish(safeResponse(413, "PAYLOAD_TOO_LARGE"), "validation");
        if (error instanceof ProxyTimeoutError) return finish(safeResponse(504, "UPSTREAM_TIMEOUT"), "timeout");
        if (request.signal?.aborted) return finish(safeResponse(499, "CLIENT_CLOSED"), "cancelled");
        if (error instanceof ProxyPolicyError) return finish(safeResponse(400, "REQUEST_REJECTED"), "security");
        if (error instanceof ProxyConfigurationError) return finish(safeResponse(500, "SERVER_CONFIGURATION_ERROR"), "security");
        if (error instanceof ProxyUpstreamError) return finish(safeResponse(502, "UPSTREAM_UNAVAILABLE"), "upstream");
        return finish(safeResponse(502, "UPSTREAM_UNAVAILABLE"), "upstream");
      }
    }
  };
}

/** Thin Node adapter: the core sees only a typed, streaming request/response interface. */
export function createNodeHttpHandler(router: ProxyRouter): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req, res) => {
    const controller = new AbortController();
    const onDisconnect = (): void => { if (!res.writableEnded) controller.abort(new Error("Client disconnected")); };
    res.once("close", onDisconnect);
    let response: ProxyOutgoing | undefined;
    try {
      response = await router.handle({ method: req.method ?? "", url: req.url ?? "", headers: req.headers,
        body: req.method === "GET" || req.method === "HEAD" ? undefined : req, signal: controller.signal, remoteAddress: req.socket.remoteAddress });
      if (controller.signal.aborted) { response.cancel?.(); return; }
      res.writeHead(response.status, response.headers);
      if (req.method !== "HEAD" && response.body) {
        for await (const chunk of response.body) {
          if (controller.signal.aborted) break;
          if (!res.write(chunk)) await once(res, "drain", { signal: controller.signal });
        }
      } else response.cancel?.();
      if (!res.writableEnded && !res.destroyed) res.end();
    } catch {
      response?.cancel?.();
      if (!res.headersSent) { res.writeHead(502, jsonHeaders); res.end(JSON.stringify({ error: "PROXY_STREAM_FAILED" })); }
      else res.destroy();
    } finally { res.removeListener("close", onDisconnect); }
  };
}
