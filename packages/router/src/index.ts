/** Native, owner-scoped ZaakiyJS routing. No browser globals at import. */
export { defineRoute, RouteConfigurationError, NavigationDeniedError,
  NavigationCancelledError, RedirectLoopError, UnsafeNavigationError } from "./types.js";
export type {
  RouteParams, RouteContext, RouteGuard, GuardDecision, RouteLoader, PageView,
  PageAdapterContext, PageAdapter, RouteModule, RouteDefinition, DefinedRoute,
  RouteTarget, RouteMatch, NavigationStatus, CancellationReason, NavigationResult,
  NavigationOptions, RouterSignals, HistoryAdapter, RouterOptions,
  NavigationServices, ReadonlySearchParams
} from "./types.js";
export { compileRoutes, matchRoutes, buildRoutePath } from "./match.js";
export type { RouteTable } from "./match.js";
export { createMemoryHistory, createBrowserHistory } from "./history.js";
export { createBrowserRestoration } from "./restoration.js";
export type { BrowserRestorationOptions, RestorationContext } from "./restoration.js";
export { Router, createRouter } from "./router.js";
