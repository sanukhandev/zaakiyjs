/** Fetch/Node server adapter. Only immutable build-controlled modules can render. */
import { createHash } from "node:crypto";
import { createOwner, disposeOwner, runWithOwner, useContext, requireContext } from "@zaakiyjs/core";
import type { ContextToken, OwnerScope } from "@zaakiyjs/core";
import { compileRoutes, matchRoutes } from "@zaakiyjs/router";
import type { RouteDefinition, NavigationServices, RouteContext } from "@zaakiyjs/router";
import { verifyTrustedManifest } from "./build.js";
import { MemoryRenderCache } from "./cache.js";
import { validateRenderPolicy } from "./config.js";
import { htmlDocument, safeLocation } from "./security.js";
import type {
  CacheScopeV1, RenderHeadAdapterV1, RenderResponseV1, RenderRoutePolicyV1,
  NodeServerAdapterV1, TrustedServerBuildManifestV1, TrustedModuleRegistration, TrustedServerRenderModuleV1
} from "./protocol.js";

export { MemoryRenderCache, createCacheInvalidator } from "./cache.js";
export { validateRenderPolicy } from "./config.js";
export { escapeHtml, safeJson, serializeHydration, serializeHead, htmlDocument, safeLocation } from "./security.js";
export { verifyTrustedManifest } from "./build.js";
export type { CacheIdentity } from "./cache.js";
export type * from "./protocol.js";

type Principal = { readonly scope: CacheScopeV1; readonly partitionKey?: string };
export interface ServerOptions {
  readonly origin: string; // trusted deployment origin, never derived from Host
  readonly routes: readonly RouteDefinition[];
  readonly policies: readonly RenderRoutePolicyV1[];
  readonly manifest: TrustedServerBuildManifestV1;
  readonly modules: Readonly<Record<string, TrustedModuleRegistration>>;
  readonly resolvePrincipal?: (request: Request, signal: AbortSignal) => Principal | Promise<Principal>;
  readonly provide?: (owner: OwnerScope, request: Request) => void;
  readonly head?: RenderHeadAdapterV1;
  readonly cache?: MemoryRenderCache;
  readonly timeoutMs?: number;
  /** Trusted CSR shell. Required for CSR policies. */
  readonly csrShell?: (request: Request) => string;
  /** Wrap trusted server-module *fragments*, not complete HTML documents. */
  readonly wrapFragments?: boolean;
  readonly cspNonce?: (request: Request) => string | undefined;
}
function digest(value: string): string { return createHash("sha256").update(value).digest("hex"); }
function abortRace<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const abort = () => { signal.removeEventListener("abort", abort); reject(signal.reason); };
    signal.addEventListener("abort", abort, { once: true });
    promise.then(value => { signal.removeEventListener("abort", abort); resolve(value); },
      error => { signal.removeEventListener("abort", abort); reject(error); });
  });
}
function terminate(scope: OwnerScope, timer: ReturnType<typeof setTimeout> | undefined,
  cleanup: () => void): void {
  if (timer) clearTimeout(timer);
  cleanup();
  disposeOwner(scope);
}
function makeResponse(result: RenderResponseV1, method: string, signal: AbortSignal, close: () => void, origin: string): Response {
  if (result.version !== 1 || !Number.isInteger(result.status) || result.status < 200 || result.status > 599)
    throw new TypeError("Invalid render response status");
  const headers = new Headers();
  for (const [key, value] of Object.entries(result.headers)) {
    if (/[\r\n]/.test(key + value)) throw new TypeError("Unsafe response header");
    headers.set(key, value);
  }
  if ([301, 302, 307, 308].includes(result.status)) {
    const location = headers.get("location");
    if (!location) throw new TypeError("Redirect response requires Location");
    headers.set("location", safeLocation(location, origin));
  }
  if (!headers.has("content-type")) headers.set("content-type", "text/html; charset=utf-8");
  headers.set("x-content-type-options", "nosniff");
  if (result.status >= 300) headers.set("x-robots-tag", "noindex");
  if (result.cache.scope !== "public" || headers.has("set-cookie"))
    headers.set("cache-control", "private, no-store");
  else if (!headers.has("cache-control")) headers.set("cache-control", "no-store");
  if (method === "HEAD" || [204, 205, 304].includes(result.status)) {
    if (typeof result.body !== "string") {
      try { void Promise.resolve(result.body[Symbol.asyncIterator]().return?.()).catch(() => undefined); }
      catch { /* The response has no body, and request cleanup must still run. */ }
    }
    close();
    return new Response(null, { status: result.status, headers });
  }
  if (typeof result.body === "string") {
    close();
    return new Response(result.body, { status: result.status, headers });
  }
  const iterator = result.body[Symbol.asyncIterator]();
  let closed = false;
  const end = (): void => {
    if (closed) return;
    closed = true;
    // Dispose request-owned resources immediately, even if the async iterator
    // cannot finish after a disconnect or an uncooperative blocked next().
    close();
    try { void Promise.resolve(iterator.return?.()).catch(() => undefined); }
    catch { /* Headers may already have been sent; do not replace the response. */ }
  };
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        if (signal.aborted) throw signal.reason;
        const next = await abortRace(Promise.resolve(iterator.next()), signal);
        if (next.done) { controller.close(); end(); return; }
        if (!(next.value instanceof Uint8Array)) throw new TypeError("Stream chunks must be bytes");
        controller.enqueue(next.value);
      } catch (error) {
        controller.error(error);
        end();
      }
    },
    cancel() { end(); }
  }, { highWaterMark: 1 });
  return new Response(stream, { status: result.status, headers });
}
function basic(status: number, body: string, scope: CacheScopeV1 = "no-store"): RenderResponseV1 {
  return { version: 1, status, headers: { "content-type": "text/html; charset=utf-8",
    "x-robots-tag": "noindex" }, body, cache: { scope, tags: [] } };
}
function contextHeaders(headers: Headers): Readonly<Record<string, string>> {
  const out: Record<string, string> = Object.create(null);
  headers.forEach((value, key) => { out[key] = value; });
  return out;
}
function getDecision(value: unknown): "allow" | "deny" | string {
  if (value === true || value === "allow" || (typeof value === "object" && value !== null &&
      "type" in value && value.type === "allow")) return "allow";
  if (typeof value === "object" && value !== null) {
    if ("redirect" in value && typeof value.redirect === "string") return value.redirect;
    if ("type" in value && value.type === "redirect" && "to" in value && typeof value.to === "string") return value.to;
  }
  return "deny";
}
function partition(principal: Principal, scope: CacheScopeV1): string | undefined {
  if (scope === "public") {
    if (principal.scope !== "public") {
      throw new TypeError("Public HTML requires an explicitly public principal");
    }
    return undefined;
  }
  if (scope === "no-store") return undefined;
  if ((principal.scope !== scope && !(principal.scope === "user" && scope === "tenant")) ||
      !principal.partitionKey || !/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,199}$/.test(principal.partitionKey)) {
    throw new TypeError("Private cache requires an authorized opaque partition");
  }
  return principal.partitionKey;
}
export function createNodeServerAdapter(options: ServerOptions): NodeServerAdapterV1 {
  const origin = new URL(options.origin);
  if (origin.protocol !== "https:" && origin.protocol !== "http:") throw new TypeError("Invalid trusted origin");
  verifyTrustedManifest(options.manifest, options.modules);
  // Pin the verified module objects and route-to-module bindings. A mutable
  // caller-owned registry cannot swap code after the manifest was verified.
  const buildId = options.manifest.buildId;
  const trustedModules = new Map<string, TrustedServerRenderModuleV1>();
  const moduleByRoute = new Map<string, string>();
  for (const [routeId, entry] of Object.entries(options.manifest.routes)) {
    const descriptor = Object.getOwnPropertyDescriptor(options.modules, entry.moduleId);
    if (!descriptor || !("value" in descriptor)) throw new TypeError("Trusted module registry changed");
    const implementation = descriptor.value.module as TrustedServerRenderModuleV1;
    const verifiedRender = implementation.render;
    trustedModules.set(entry.moduleId, {
      protocol: "zaakiy.render/1",
      render: context => verifiedRender.call(implementation, context)
    });
    moduleByRoute.set(routeId, entry.moduleId);
  }
  const table = compileRoutes(options.routes);
  const policies = new Map<string, RenderRoutePolicyV1>();
  for (const policy of options.policies) {
    validateRenderPolicy(policy);
    if (policies.has(policy.routeId) || !table.byId.has(policy.routeId)) throw new TypeError("Invalid policy route ID");
    policies.set(policy.routeId, policy);
  }
  if (options.head && options.head.version !== 1) throw new TypeError("Incompatible SEO adapter");
  const timeout = options.timeoutMs ?? 30_000;
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 120_000) throw new TypeError("Invalid timeout");
  return {
    version: 1,
    async handle(request, context) {
      if (!["GET", "HEAD"].includes(request.method)) return new Response(null, { status: 405, headers: { allow: "GET, HEAD" } });
      const url = new URL(request.url);
      if (url.origin !== origin.origin) return new Response(null, { status: 400 });
      const controller = new AbortController();
      const root = createOwner();
      const stop = () => controller.abort(new Error("Request cancelled"));
      request.signal.addEventListener("abort", stop, { once: true });
      context.signal.addEventListener("abort", stop, { once: true });
      if (request.signal.aborted || context.signal.aborted) stop();
      const timer = setTimeout(() => controller.abort(new Error("Request timeout")), timeout);
      let closed = false;
      const close = () => {
        if (closed) return;
        closed = true;
        request.signal.removeEventListener("abort", stop);
        context.signal.removeEventListener("abort", stop);
        controller.signal.removeEventListener("abort", onStreamAbort);
        terminate(root, timer, () => undefined);
      };
      let streaming = false;
      // An aborted streamed response must tear down its Core owner even if
      // the consumer never pulls or explicitly cancels the body.
      const onStreamAbort = () => {
        if (streaming) {
          try { close(); } catch { /* Cleanup is best effort after disconnect. */ }
        }
      };
      controller.signal.addEventListener("abort", onStreamAbort, { once: true });
      try {
        const matches = matchRoutes(table, url.pathname);
        if (!matches.length) return makeResponse(basic(404, "Not Found"), request.method, controller.signal, close, origin.origin);
        const leaf = matches[matches.length - 1]!;
        const policy = policies.get(leaf.route.id);
        if (!policy) return makeResponse(basic(503, "Route is not configured for rendering"), request.method, controller.signal, close, origin.origin);
        const principal = await abortRace(Promise.resolve(
          options.resolvePrincipal?.(request, controller.signal) ?? { scope: "no-store" as const }
        ), controller.signal);
        if (principal.scope !== "no-store" && principal.scope !== "public" && !principal.partitionKey)
          throw new TypeError("Private principal must include a partition");
        if (options.provide) runWithOwner(root, () => options.provide!(root, request));
        const services: NavigationServices = {
          get<T>(key: ContextToken<T>): T | undefined { return useContext(root, key); },
          require<T>(key: ContextToken<T>): T { return requireContext(root, key); }
        };
        const common = { to: url, from: url, hash: url.hash, search: new URLSearchParams(url.search),
          signal: controller.signal, owner: root, services };
        let data: unknown;
        for (const match of matches) {
          const route = match.route;
          if (route.lazy) return makeResponse(basic(503, "Server lazy route integration unavailable"), request.method, controller.signal, close, origin.origin);
          const rc: RouteContext = { ...common, params: match.params };
          if (route.guard) {
            const decision = getDecision(await abortRace(Promise.resolve(runWithOwner(root, () => route.guard!(rc))), controller.signal));
            if (decision === "deny") return makeResponse(basic(403, "Forbidden"), request.method, controller.signal, close, origin.origin);
            if (decision !== "allow") {
              const location = safeLocation(decision, origin.origin);
              return makeResponse({ version: 1, status: 307, headers: { location }, body: "",
                cache: { scope: "no-store", tags: [] } }, request.method, controller.signal, close, origin.origin);
            }
          }
          if (route.loader) data = await abortRace(Promise.resolve(runWithOwner(root, () => route.loader!(rc))), controller.signal);
        }
        if (policy.mode === "csr") {
          if (!options.csrShell) return makeResponse(basic(503, "CSR shell unavailable"), request.method, controller.signal, close, origin.origin);
          return makeResponse({ version: 1, status: 200, headers: {}, body: options.csrShell(request),
            cache: { scope: "no-store", tags: [] } }, request.method, controller.signal, close, origin.origin);
        }
        if (policy.mode === "ssg") return makeResponse(basic(503, "SSG pages must be deployed from build artifacts"),
          request.method, controller.signal, close, origin.origin);
        const moduleId = moduleByRoute.get(leaf.route.id);
        const module = moduleId === undefined ? undefined : trustedModules.get(moduleId);
        if (!module) return makeResponse(basic(503, "Trusted server module unavailable"), request.method, controller.signal, close, origin.origin);
        const cachePolicy = policy.cache;
        const cacheScope = cachePolicy?.scope ?? "no-store";
        const part = partition(principal, cacheScope);
        const trusted = {
          schema: "zaakiy.render/1" as const,
          request: { url, method: request.method as "GET" | "HEAD", headers: contextHeaders(request.headers),
            signal: controller.signal },
          route: { id: leaf.route.id, params: leaf.params }, owner: root, services,
          loaderData: data, principal
        };
        const render = async (): Promise<RenderResponseV1> => {
          const result = await abortRace(Promise.resolve(runWithOwner(root, () => module.render(trusted))), controller.signal);
          if (result.cache.scope !== cacheScope) throw new TypeError("Server response cache scope differs from route policy");
          if (result.cache.tags.some(tag => !cachePolicy?.tags.includes(tag))) throw new TypeError("Unexpected response cache tag");
          if (options.head && options.wrapFragments && typeof result.body === "string" && result.status === 200) {
            const head = await abortRace(Promise.resolve(options.head.resolve({
              routeId: leaf.route.id, url, status: result.status, loaderData: data
            })), controller.signal);
            return { ...result, body: htmlDocument(result.body, head, origin.origin, options.cspNonce?.(request)) };
          }
          return result;
        };
        let result: RenderResponseV1;
        if (policy.mode === "hybrid" && cacheScope !== "no-store" && cachePolicy &&
            cachePolicy.ttlSeconds > 0 && options.cache) {
          const cleanQuery = new URLSearchParams(url.search);
          // Query dimensions cannot be dropped without a proved route contract.
          // Only stable ordering is normalized here.
          cleanQuery.sort();
          const vary = (cachePolicy.vary ?? []).map(name => name + "=" + (request.headers.get(name) ?? "")).join("&");
          const key = digest([buildId, leaf.route.id, request.method, url.pathname,
            cleanQuery.toString(), cacheScope, part ?? "", vary].join("\0"));
          result = await abortRace(options.cache.getOrRender(key, {
            routeId: leaf.route.id, buildId,
            scope: cacheScope, partitionKey: part, tags: cachePolicy.tags, ttlSeconds: cachePolicy.ttlSeconds,
            ...(cachePolicy.vary ? { vary: cachePolicy.vary } : {})
          }, render), controller.signal);
        } else result = await render();
        streaming = typeof result.body !== "string" && request.method === "GET";
        const response = makeResponse(result, request.method, controller.signal, close, origin.origin);
        return response;
      } catch (error) {
        if (controller.signal.aborted) return makeResponse(basic(503, "Request unavailable"),
          request.method, controller.signal, close, origin.origin);
        // Fail closed. Do not reflect exception details or loader data to clients.
        void error;
        return makeResponse(basic(500, "Internal Server Error"), request.method, controller.signal, close, origin.origin);
      } finally {
        if (!streaming) close();
      }
    }
  };
}
