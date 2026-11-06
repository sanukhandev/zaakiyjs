import { resolveMetadata } from "./metadata.js";
import type { MetadataDefinition, ResolveMetadataOptions, ResolvedMetadata } from "./types.js";
export interface RouteSeoConfig<Data = unknown, Params extends Readonly<Record<string, string>> = Readonly<Record<string, string>>> {
  readonly id: string;
  readonly metadata?: MetadataDefinition<Data, Params>;
  readonly parentId?: string;
}
export function resolveRouteMetadata<Data = unknown, Params extends Readonly<Record<string, string>> = Readonly<Record<string, string>>>(
  routeId: string, routes: readonly RouteSeoConfig<Data, Params>[],
  defaults: MetadataDefinition<Data, Params>, options: ResolveMetadataOptions<Data, Params>
): ResolvedMetadata {
  const byId = new Map(routes.map(route => [route.id, route] as const));
  const lineage: RouteSeoConfig<Data, Params>[] = [];
  const visited = new Set<string>();
  let current: string | undefined = routeId;
  while (current !== undefined) {
    if (visited.has(current)) throw new TypeError("Circular SEO route ancestry");
    visited.add(current);
    const route = byId.get(current);
    if (!route) throw new TypeError("Unknown SEO route: " + current);
    lineage.unshift(route);
    current = route.parentId;
  }
  return resolveMetadata([defaults, ...lineage.flatMap(route => route.metadata ? [route.metadata] : [])], options);
}
