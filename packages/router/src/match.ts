import { RouteConfigurationError } from "./types.js";
import type { CompiledRoute, RouteDefinition, RouteMatch } from "./types.js";

const PARAM = /^:[A-Za-z_$][\w$]*$/;
function segments(path: string): string[] {
  return path.split("/").filter(Boolean);
}
function normalized(path: string): string {
  return "/" + segments(path).join("/");
}
function compileTokens(path: string): CompiledRoute["tokens"] {
  const parts = segments(path);
  return parts.map((part, i) => {
    if (part === "*") {
      if (i !== parts.length - 1) throw new RouteConfigurationError("Wildcard must be the final segment: " + path);
      return { kind: "wildcard" as const };
    }
    if (part.startsWith(":")) {
      if (!PARAM.test(part)) throw new RouteConfigurationError("Invalid route parameter: " + part);
      return { kind: "param" as const, name: part.slice(1) };
    }
    if (part.includes("*") || part.includes("?") || part.includes("#") || part === "." || part === ".." || part.includes("%") || part.includes("\\")) {
      throw new RouteConfigurationError("Unsupported or unsafe route segment: " + part);
    }
    return { kind: "literal" as const, value: part };
  });
}
function signature(route: CompiledRoute): string {
  return route.tokens.map(t => t.kind === "literal" ? "s:" + t.value : t.kind).join("/");
}
function rank(a: CompiledRoute, b: CompiledRoute): number {
  const n = Math.max(a.tokens.length, b.tokens.length);
  for (let i = 0; i < n; i++) {
    const av = a.tokens[i]?.kind === "literal" ? 3 : a.tokens[i]?.kind === "param" ? 2 : a.tokens[i]?.kind === "wildcard" ? 0 : 1;
    const bv = b.tokens[i]?.kind === "literal" ? 3 : b.tokens[i]?.kind === "param" ? 2 : b.tokens[i]?.kind === "wildcard" ? 0 : 1;
    if (av !== bv) return bv - av;
  }
  return b.parents.length - a.parents.length || a.fullPath.localeCompare(b.fullPath);
}
export interface RouteTable {
  readonly routes: readonly CompiledRoute[];
  readonly byId: ReadonlyMap<string, CompiledRoute>;
}
export function compileRoutes(definitions: readonly RouteDefinition[]): RouteTable {
  const all: CompiledRoute[] = [];
  const byId = new Map<string, CompiledRoute>();
  const seen = new Map<string, CompiledRoute>();
  const visiting = new Set<RouteDefinition>();
  const walk = (routes: readonly RouteDefinition[], parent: string, ancestors: readonly RouteDefinition[]): void => {
    for (const route of routes) {
      if (visiting.has(route)) throw new RouteConfigurationError("Cyclic route configuration");
      if (!route.id || !/^[\w.-]+$/.test(route.id) || byId.has(route.id)) {
        throw new RouteConfigurationError("Duplicate or invalid route id: " + route.id);
      }
      if (typeof route.path !== "string" || route.path.includes("//") || (ancestors.length > 0 && route.path.startsWith("/"))) {
        throw new RouteConfigurationError("Invalid child or absolute route path: " + route.path);
      }
      const fullPath = normalized(parent + "/" + route.path);
      const tokens = compileTokens(fullPath);
      const names = tokens.filter(t => t.kind === "param").map(t => t.kind === "param" ? t.name : "");
      if (new Set(names).size !== names.length) throw new RouteConfigurationError("Duplicate route parameter in " + fullPath);
      const entry: CompiledRoute = { route, fullPath, tokens, parents: [...ancestors, route] };
      const key = signature(entry);
      const previous = seen.get(key);
      // An empty-path index child can legitimately share its layout's URL.
      if (previous && !(route.path === "" && ancestors.includes(previous.route))) {
        throw new RouteConfigurationError("Ambiguous route pattern: " + fullPath);
      }
      seen.set(key, entry);
      byId.set(route.id, entry);
      all.push(entry);
      if (route.children?.length) {
        if (tokens.some(t => t.kind === "wildcard")) throw new RouteConfigurationError("Wildcard routes cannot have children");
        visiting.add(route);
        walk(route.children, fullPath, entry.parents);
        visiting.delete(route);
      }
    }
  };
  walk(definitions, "", []);
  all.sort(rank);
  return { routes: all, byId };
}
/** Pure deterministic matcher, safe in Node and future SSR request contexts. */
export function matchRoutes(table: RouteTable, pathname: string): readonly RouteMatch[] {
  const parts = segments(pathname);
  for (const entry of table.routes) {
    const params: Record<string, string> = {};
    let matched = true;
    let offset = 0;
    for (const token of entry.tokens) {
      if (token.kind === "wildcard") { offset = parts.length; break; }
      const part = parts[offset++];
      if (part === undefined) { matched = false; break; }
      if (token.kind === "literal" && token.value !== part) { matched = false; break; }
      if (token.kind === "param") {
        try { params[token.name] = decodeURIComponent(part); }
        catch { matched = false; break; }
      }
    }
    if (!matched || offset !== parts.length) continue;
    const result: RouteMatch[] = [];
    let prefix = "";
    for (const ancestor of entry.parents) {
      prefix = normalized(prefix + "/" + ancestor.path);
      const localParams: Record<string, string> = {};
      compileTokens(prefix).forEach(token => {
        if (token.kind === "param" && params[token.name] !== undefined) {
          localParams[token.name] = params[token.name]!;
        }
      });
      result.push({ route: ancestor, params: Object.freeze(localParams), pathname: prefix });
    }
    return result;
  }
  return [];
}
export function buildRoutePath(entry: CompiledRoute, params: Readonly<Record<string, string>>): string {
  return "/" + entry.tokens.map(token => {
    if (token.kind === "literal") return token.value;
    if (token.kind === "wildcard") throw new RouteConfigurationError("Cannot generate a wildcard route URL");
    const value = params[token.name];
    if (typeof value !== "string" || value.length === 0 || value === "." || value === "..") {
      throw new RouteConfigurationError("Missing or invalid route parameter: " + token.name);
    }
    return encodeURIComponent(value);
  }).join("/");
}
