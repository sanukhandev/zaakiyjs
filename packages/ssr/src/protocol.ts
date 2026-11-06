import type { OwnerScope } from "@zaakiyjs/core";
import type { NavigationServices } from "@zaakiyjs/router";

export type RenderModeV1 = "csr" | "ssr" | "ssg" | "hybrid";
export type CacheScopeV1 = "public" | "tenant" | "user" | "no-store";
export type HydrationMismatchV1 = "abort" | "replace-owned-boundary";
export interface RenderCachePolicyV1 {
  readonly scope: CacheScopeV1;
  readonly ttlSeconds: number;
  readonly tags: readonly string[];
  readonly vary?: readonly string[];
  readonly staleWhileRevalidateSeconds?: number;
}
export interface RenderRoutePolicyV1 {
  readonly version: 1;
  readonly routeId: string;
  readonly mode: RenderModeV1;
  readonly hydration?: { readonly enabled: boolean; readonly onMismatch: HydrationMismatchV1 };
  readonly cache?: RenderCachePolicyV1;
}
export interface TrustedServerBuildManifestV1 {
  readonly schema: "zaakiy.render-manifest/1";
  readonly buildId: string;
  readonly irVersion: 1;
  readonly domAbiVersion: 1;
  readonly routes: Readonly<Record<string, {
    readonly moduleId: string;
    readonly sourceDigest: string;
    readonly routeId: string;
  }>>;
}
export interface ServerRequestContextV1 {
  readonly schema: "zaakiy.render/1";
  readonly request: {
    readonly url: URL;
    readonly method: "GET" | "HEAD";
    readonly headers: Readonly<Record<string, string>>;
    readonly signal: AbortSignal;
  };
  readonly route: { readonly id: string; readonly params: Readonly<Record<string, string>> };
  readonly owner: OwnerScope;
  readonly services: NavigationServices;
  readonly loaderData: unknown;
  readonly principal: { readonly scope: CacheScopeV1; readonly partitionKey?: string };
  readonly initialConsent?: unknown;
}
export interface HydrationEnvelopeV1 {
  readonly schema: "zaakiy.hydration/1";
  readonly buildId: string;
  readonly domAbiVersion: 1;
  readonly routeId: string;
  readonly boundaries: readonly { readonly markerId: string; readonly templateDigest: string }[];
  readonly payload: unknown;
}
export interface RenderResponseV1 {
  readonly version: 1;
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string | AsyncIterable<Uint8Array>;
  readonly cache: { readonly scope: CacheScopeV1; readonly tags: readonly string[] };
  readonly hydration?: HydrationEnvelopeV1;
}
export interface TrustedServerRenderModuleV1 {
  readonly protocol: "zaakiy.render/1";
  render(context: ServerRequestContextV1): RenderResponseV1 | Promise<RenderResponseV1>;
}
export interface RenderInvalidationRequestV1 {
  readonly version: 1;
  readonly tags: readonly string[];
  readonly scope: Exclude<CacheScopeV1, "no-store">;
  readonly partitionKey?: string;
  readonly principalId: string;
  readonly issuedAt: string;
  readonly idempotencyKey: string;
}
export interface RenderCacheInvalidatorV1 {
  readonly version: 1;
  invalidate(request: RenderInvalidationRequestV1, signal: AbortSignal): Promise<{ readonly invalidatedCount: number }>;
}
export interface RenderHeadEntryV1 {
  readonly tag: "title" | "meta" | "link" | "script-jsonld";
  readonly attributes?: Readonly<Record<string, string>>;
  readonly text?: string;
}
export interface RenderHeadAdapterV1 {
  readonly version: 1;
  resolve(input: { readonly routeId: string; readonly url: URL; readonly status: number;
    readonly loaderData: unknown }): Promise<readonly RenderHeadEntryV1[]> | readonly RenderHeadEntryV1[];
}
export interface NodeServerAdapterV1 {
  readonly version: 1;
  handle(request: Request, context: { readonly signal: AbortSignal }): Promise<Response>;
}
export interface TrustedModuleRegistration {
  readonly sourceDigest: string;
  readonly module: TrustedServerRenderModuleV1;
}
