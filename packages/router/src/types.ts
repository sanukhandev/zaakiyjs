import type { OwnerScope, ContextToken } from "@zaakiyjs/core";
import type { ReadonlySignal } from "@zaakiyjs/signals";

/** Parameter names are inferred from required colon-prefixed path segments. */
type SegmentParam<S extends string> = S extends `:${infer Name}` ? Name : never;
type ParamKeys<S extends string> =
  S extends `${infer Head}/${infer Tail}`
    ? SegmentParam<Head> | ParamKeys<Tail>
    : SegmentParam<S>;
export type RouteParams<Path extends string> =
  [ParamKeys<Path>] extends [never] ? Record<string, never> :
  { readonly [K in ParamKeys<Path>]: string };

export type MaybePromise<T> = T | Promise<T>;
export interface NavigationServices {
  get<T>(token: ContextToken<T>): T | undefined;
  require<T>(token: ContextToken<T>): T;
}
export interface RouteContext<P extends Record<string, string> = Record<string, string>> {
  readonly params: Readonly<P>;
  readonly search: URLSearchParams;
  readonly hash: string;
  readonly to: URL;
  readonly from: URL;
  readonly signal: AbortSignal;
  readonly owner: OwnerScope;
  readonly services: NavigationServices;
}
export type GuardDecision =
  | true | false | "allow" | "deny"
  | { readonly redirect: string }
  | { readonly type: "allow" | "deny" }
  | { readonly type: "redirect"; readonly to: string };
export type RouteGuard<P extends Record<string, string> = Record<string, string>> =
  (context: RouteContext<P>) => MaybePromise<GuardDecision>;
export type RouteLoader<P extends Record<string, string> = Record<string, string>> =
  (context: RouteContext<P>) => MaybePromise<unknown>;

export interface PageView {
  /** Native DOM output of an already compiler-lowered view factory. */
  readonly node: Node;
  /** Required when this page has a nested child route with visible content. */
  readonly outlet?: Element;
}
export interface PageAdapterContext<
  P extends Record<string, string> = Record<string, string>, Data = unknown
> extends RouteContext<P> {
  readonly data: Data;
  readonly metadata: Readonly<Record<string, unknown>>;
}
/**
 * Setup is synchronous and executes inside runWithOwner; async work belongs in
 * loaders, never in a Promise continuation pretending to have lexical ownership.
 */
export interface PageAdapter<
  P extends Record<string, string> = Record<string, string>,
  Model = unknown,
  Data = unknown
> {
  readonly setup?: (context: PageAdapterContext<P, Data>) => Model;
  readonly render: (model: Model, context: PageAdapterContext<P, Data>) => PageView;
}
/** Preserve strong Model and loader-data types at the application boundary. */
export function definePageAdapter<
  P extends Record<string, string>, Model, Data = unknown
>(adapter: PageAdapter<P, Model, Data>): PageAdapter<P> {
  return adapter as unknown as PageAdapter<P>;
}
export interface RouteModule {
  readonly loader?: RouteLoader;
  readonly adapter?: PageAdapter;
}
export interface RouteDefinition {
  readonly id: string;
  /** Root paths may begin with /; child paths are relative. '*' is terminal. */
  readonly path: string;
  readonly children?: readonly RouteDefinition[];
  readonly guard?: RouteGuard;
  readonly loader?: RouteLoader;
  readonly adapter?: PageAdapter;
  readonly lazy?: () => Promise<RouteModule>;
  readonly metadata?: Readonly<Record<string, unknown>>;
}
export type DefinedRoute<Path extends string> = RouteDefinition & {
  readonly path: Path;
  /** Compile-time only: strongly typed route target. */
  readonly __params?: RouteParams<Path>;
};
export function defineRoute<const P extends string>(
  route: Omit<RouteDefinition, "path" | "guard" | "loader" | "adapter"> & {
    readonly path: P;
    readonly guard?: RouteGuard<RouteParams<P>>;
    readonly loader?: RouteLoader<RouteParams<P>>;
    readonly adapter?: PageAdapter<RouteParams<P>>;
  }
): DefinedRoute<P> {
  return route as unknown as DefinedRoute<P>;
}
export type RouteTarget<P extends string = string> = {
  readonly route: DefinedRoute<P>;
  readonly params: RouteParams<NoInfer<P>>;
  readonly search?: URLSearchParams | string | Readonly<Record<string, string>>;
  readonly hash?: string;
};
export interface CompiledRoute {
  readonly route: RouteDefinition;
  readonly fullPath: string;
  readonly tokens: readonly ({ readonly kind: "literal"; readonly value: string } |
    { readonly kind: "param"; readonly name: string } |
    { readonly kind: "wildcard" })[];
  readonly parents: readonly RouteDefinition[];
}
export interface RouteMatch {
  readonly route: RouteDefinition;
  readonly params: Readonly<Record<string, string>>;
  readonly pathname: string;
}
export interface ActiveRoute extends RouteMatch {
  readonly owner: OwnerScope;
  readonly data: unknown;
  readonly module: RouteModule | undefined;
}
export type NavigationStatus = "idle" | "loading" | "blocked" | "error";
export type CancellationReason = "superseded" | "explicit" | "owner-disposed" | "router-disposed";
export interface NavigationResult {
  readonly status: "committed" | "cancelled" | "blocked";
  readonly url: string;
}
export interface NavigationOptions {
  readonly history?: "push" | "replace" | "none";
  readonly force?: boolean;
}
export interface RouterSignals {
  readonly url: ReadonlySignal<string>;
  readonly matches: ReadonlySignal<readonly ActiveRoute[]>;
  readonly params: ReadonlySignal<Readonly<Record<string, string>>>;
  readonly search: ReadonlySignal<ReadonlySearchParams>;
  readonly hash: ReadonlySignal<string>;
  readonly status: ReadonlySignal<NavigationStatus>;
  readonly pending: ReadonlySignal<string | null>;
  readonly error: ReadonlySignal<unknown>;
}
/** Immutable facade: mutating native URLSearchParams must not bypass navigation. */
export interface ReadonlySearchParams extends Iterable<[string, string]> {
  get(name: string): string | null;
  getAll(name: string): string[];
  has(name: string, value?: string): boolean;
  entries(): URLSearchParamsIterator<[string, string]>;
  keys(): URLSearchParamsIterator<string>;
  values(): URLSearchParamsIterator<string>;
  forEach(callback: (value: string, key: string) => void): void;
  toString(): string;
}
export interface HistoryAdapter {
  current(): string;
  push(url: string): void;
  replace(url: string): void;
  go(delta: number): void;
  listen(callback: () => void): () => void;
}
export interface RouterOptions {
  readonly routes: readonly RouteDefinition[];
  readonly owner: OwnerScope;
  readonly history: HistoryAdapter;
  readonly base?: string;
  readonly maxRedirects?: number;
  readonly onNavigate?: (context: { readonly url: string; readonly matches: readonly ActiveRoute[]; readonly isPop: boolean }) => void;
}
export class RouteConfigurationError extends Error { override name = "RouteConfigurationError"; }
export class RouteNotFoundError extends Error { override name = "RouteNotFoundError"; }
export class NavigationDeniedError extends Error { override name = "NavigationDeniedError"; }
export class NavigationCancelledError extends Error {
  override name = "NavigationCancelledError";
  constructor(readonly reason: CancellationReason) { super("Navigation cancelled: " + reason); }
}
export class RedirectLoopError extends Error { override name = "RedirectLoopError"; }
export class UnsafeNavigationError extends Error { override name = "UnsafeNavigationError"; }
