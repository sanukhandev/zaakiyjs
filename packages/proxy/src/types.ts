import type { IncomingHttpHeaders } from "node:http";

export interface LookupAddress { readonly address: string; readonly family: 4 | 6 }
/** Resolve once, then connect to the selected address without a second DNS lookup. */
export type AddressResolver = (hostname: string, signal: AbortSignal) => Promise<readonly LookupAddress[]>;
export type ProxyBody = AsyncIterable<Uint8Array>;
export interface ProxyIncoming {
  readonly method: string;
  /** Origin-form only, e.g. /api/items?page=1. */
  readonly url: string;
  readonly headers: Readonly<IncomingHttpHeaders>;
  readonly body?: ProxyBody;
  readonly signal?: AbortSignal;
  /** From a trusted transport adapter, not X-Forwarded-For. */
  readonly remoteAddress?: string;
}
export interface ProxyOutgoing {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: ProxyBody;
  /** Must be called if the consumer does not drain body. */
  readonly cancel?: () => void;
}
export interface ProxyPrincipal {
  readonly subject: string;
  readonly tenantId?: string;
  readonly roles?: readonly string[];
  readonly permissions?: readonly string[];
}
export interface AuthenticationContext {
  readonly request: ProxyIncoming;
  readonly routeId: string;
  readonly signal: AbortSignal;
}
export type Authenticator = (context: AuthenticationContext) => Promise<ProxyPrincipal | null> | ProxyPrincipal | null;
export interface AuthorizationContext {
  readonly principal: ProxyPrincipal;
  readonly routeId: string;
  readonly params: Readonly<Record<string, string>>;
  readonly method: string;
  readonly signal: AbortSignal;
}
export type Authorizer = (context: AuthorizationContext) => Promise<boolean> | boolean;
export type ProxyAccess = "public" | "authenticated";
export interface ProxyRateLimit { readonly max: number; readonly windowMs: number; readonly by: "principal" | "tenant" | "address" }
export interface RateLimitInput { readonly key: string; readonly max: number; readonly windowMs: number; readonly now: number }
export interface RateLimitDecision { readonly allowed: boolean; readonly retryAfterSeconds?: number }
export interface RateLimitStore { check(input: RateLimitInput): Promise<RateLimitDecision> | RateLimitDecision }
export interface ValidatedRequestContext {
  readonly routeId: string;
  readonly params: Readonly<Record<string, string>>;
  readonly principal: ProxyPrincipal | null;
  readonly method: string;
  readonly query: URLSearchParams;
  readonly signal: AbortSignal;
}
export type RequestValidator = (context: ValidatedRequestContext) => Promise<boolean> | boolean;
/** Hooks are observational; they cannot override upstream, path, identity or the security decision. */
export interface ProxyHooks {
  readonly beforeDispatch?: (context: ValidatedRequestContext) => Promise<void> | void;
  readonly afterResponse?: (context: ValidatedRequestContext, status: number) => Promise<void> | void;
}
export interface ProxyUpstream {
  /** Absolute origin only. No userinfo, path, query or fragment. */
  readonly origin: string;
  readonly basePath?: string;
  readonly connectTimeoutMs?: number;
  readonly timeoutMs?: number;
  readonly maxResponseBytes?: number;
  /** Explicit, exact addresses allowlisted for trusted private-network deployments. */
  readonly allowedPrivateAddresses?: readonly string[];
  /** Must be explicitly enabled for plain HTTP deployments. TLS validation is never disabled. */
  readonly allowInsecureHttp?: boolean;
  /** Server-side credentials, never copied from an incoming request. */
  readonly credentials?: (context: ValidatedRequestContext) => Promise<Readonly<Record<string, string>>> | Readonly<Record<string, string>>;
}
export interface ProxyRoute {
  readonly id: string;
  /** Exact, /prefix/*, or /path/:param. */
  readonly path: string;
  readonly upstream: string;
  readonly methods: readonly string[];
  readonly access: ProxyAccess;
  /** Required for protected routes; called even after authentication succeeds. */
  readonly authorize?: Authorizer;
  readonly rateLimit?: ProxyRateLimit;
  readonly maxRequestBytes?: number;
  readonly timeoutMs?: number;
  readonly requestHeaders?: readonly string[];
  readonly responseHeaders?: readonly string[];
  readonly validate?: RequestValidator;
  readonly hooks?: ProxyHooks;
  /** GET/HEAD only, max 2 additional attempts. No streaming-body replays. */
  readonly retry?: { readonly attempts: 1 | 2 };
}
export interface ProxyDiagnostic {
  readonly requestId: string;
  readonly routeId?: string;
  readonly upstreamId?: string;
  readonly category: "success" | "not_found" | "method" | "authn" | "authz" | "rate_limit" | "validation" | "security" | "upstream" | "timeout" | "cancelled";
  readonly status: number;
  readonly durationMs: number;
}
export interface ProxyConfig {
  readonly upstreams: Readonly<Record<string, ProxyUpstream>>;
  readonly routes: readonly ProxyRoute[];
  readonly authenticate?: Authenticator;
  readonly resolver?: AddressResolver;
  readonly rateLimitStore?: RateLimitStore;
  readonly onDiagnostic?: (event: ProxyDiagnostic) => void;
}
export interface ProxyRouter { handle(request: ProxyIncoming): Promise<ProxyOutgoing> }
