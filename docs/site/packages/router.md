---
title: "@zaakiyjs/router"
description: "Typed client-side routes, guards, loaders, cancellation, nested layouts and navigation state"
sidebar_position: 9
---

# @zaakiyjs/router

Use Router for app navigation and page owners, with cancellation-aware loaders and explicit DOM page adapters.

> **Availability:** Source implementation in ZaakiyJS, not a verified published npm release. The package's manifest at the referenced revision uses `0.0.0`; use workspace tooling until independent publishing is approved.

## At a glance

- **Use it when:** Attach a native DOM outlet, start the router once, and drive page transitions through registered route definitions.
- **Reference revision:** [9f6c6603c98c](https://github.com/sanukhandev/zaakiyjs/commit/9f6c6603c98ca566c2fed6fed34cc770f6a72960).

## Try it in the monorepo

```sh
pnpm --filter @zaakiyjs/router typecheck
pnpm --filter @zaakiyjs/router test
pnpm --filter @zaakiyjs/router build
```

## Feature usage: first working pattern

```ts
import { createOwner } from '@zaakiyjs/core';
import { createRouter, createBrowserHistory, defineRoute } from '@zaakiyjs/router';

const home = defineRoute({ id: 'home', path: '/' });
const owner = createOwner();
const router = createRouter({
  owner,
  routes: [home, { id: 'missing', path: '*' }],
  history: createBrowserHistory()
});
router.attachOutlet(document.getElementById('pages')!);
await router.start();
await router.navigate({ route: home, params: {} });
// Later: router.dispose();
```

For rendered pages, register real compiled native-node page adapters; defining a route alone does not produce a page view.

## Usage and correctness guidelines

- Guards run before navigation commit, but client-side guards do not replace backend authorization.
- Superseding navigation aborts previous loader work and discards stale results; the caller must still honor AbortSignal for actual network side effects.
- Deployed SPAs require host-side deep-link fallback; Router does not supply HTTP status or SSR semantics.

## Public API index

Exported symbols detected in the package root `src/index.ts`. Platform-specific subpaths and structural contracts are explained in the detailed guide and package manifest.

- `BrowserRestorationOptions`
- `CancellationReason`
- `DefinedRoute`
- `GuardDecision`
- `HistoryAdapter`
- `NavigationCancelledError`
- `NavigationDeniedError`
- `NavigationOptions`
- `NavigationResult`
- `NavigationServices`
- `NavigationStatus`
- `PageAdapter`
- `PageAdapterContext`
- `PageView`
- `ReadonlySearchParams`
- `RedirectLoopError`
- `RestorationContext`
- `RouteConfigurationError`
- `RouteContext`
- `RouteDefinition`
- `RouteGuard`
- `RouteLoader`
- `RouteLoaderError`
- `RouteMatch`
- `RouteModule`
- `RouteModuleLoadError`
- `RouteNotFoundError`
- `RouteParams`
- `RouteTable`
- `RouteTarget`
- `Router`
- `RouterOptions`
- `RouterSignals`
- `UnsafeNavigationError`
- `buildRoutePath`
- `compileRoutes`
- `createBrowserHistory`
- `createBrowserRestoration`
- `createMemoryHistory`
- `createRouter`
- `definePageAdapter`
- `defineRoute`
- `matchRoutes`

## Detailed feature guide

### Core API

```ts
import { createOwner, createContext, provide } from "@zaakiyjs/core";
import {
  createRouter, createBrowserHistory, defineRoute,
  createBrowserRestoration
} from "@zaakiyjs/router";

const repo = createContext<{ find(id: string, signal: AbortSignal): Promise<string> }>("ProductRepository");
const product = defineRoute({
  id: "product",
  path: "products/:id",
  loader: ({ params, signal, services }) =>
    services.require(repo).find(params.id, signal)
});
const routes = [
  {
    id: "root", path: "/",
    children: [
      { id: "home", path: "" },
      product,
      { id: "notfound", path: "*" }
    ]
  }
];
const owner = createOwner();
provide(owner, repo, { find: async id => id });
const router = createRouter({
  owner,
  routes,
  history: createBrowserHistory(),
  onNavigate: createBrowserRestoration(window, { scroll: "auto" })
});
await router.start();
await router.navigate({ route: product, params: { id: "123" } });
```

`defineRoute()` infers required parameters from colon segments. The leaf's `params` are typed for locally declared path segments; nested parent parameters are available at runtime through the combined route match context. Use a type-level wrapper for full-tree parameter contracts if your route needs stronger inherited parameter typing. Route target references must be registered in the router.

#### Page adapters and MVVM

A `PageAdapter` is a framework-neutral coordinator. Its optional `setup` runs *synchronously* with the route's Core owner; it can provide repositories and register `onCleanup`. Its `render` returns a **native DOM Node**, produced by an already compiled ZaakiyJS view factory, and optionally an `outlet` element contained in the node. Nested layouts preserve their owner and native DOM identity while child routes change.

```ts
import { runWithOwner, onCleanup } from "@zaakiyjs/core";
import type { PageAdapter } from "@zaakiyjs/router";

const adapter: PageAdapter<{ id: string }> = {
  setup({ params, services, owner }) {
    const repo = services.require(productRepositoryToken);
    const vm = createProductViewModel(repo, params.id);
    onCleanup(() => vm.dispose());
    return vm;
  },
  render(vm, ctx) {
    // The view function here must already be compiled to native DOM,
    // not an uncompiled JSX component or an invented runtime helper.
    return { node: renderCompiledProductView(vm, ctx.owner) };
  }
};
// register adapter on a route, then before router.start():
router.attachOutlet(document.getElementById("page")!);
```

For stronger Model and loader-data typing, use the public `definePageAdapter<Params, Model, Data>(...)` factory at the application boundary. The identifiers `productRepositoryToken`, `createProductViewModel`, and `renderCompiledProductView` in this conceptual example are **application-defined**, not Router exports. Rendering adapters must return one native root node; `DocumentFragment` and automatic multi-root route mounting are not yet supported. When a page has a rendered nested child, it must return an `outlet`.

### Behavior contract

- Routes compile to a deterministic, pure path table. Literal segments outrank `:params`, terminal `*` is the fallback, and unsupported optional/splat grammar throws. Duplicate IDs and ambiguous route patterns fail at registration. Empty-path index children may share their parent layout's URL.
- `base` confines routing to an app path. Navigation accepts safe relative or same-app absolute path strings, or registered typed targets. External/protocol-relative, script-scheme, malformed, and out-of-base destinations throw. Client guards are **not server authorization**.
- `start()` is idempotent and registers one `popstate`/`hashchange` subscription. `navigate(url, { history: "push" | "replace" | "none", force?: boolean })`, `back()`, `forward()`, `cancel()`, and `dispose()` manage routing explicitly. `force` reinitializes a destination; identical URLs otherwise do not remount.
- Every navigation has a native AbortController; newer navigation aborts the prior transaction. Guard/loader context signals combine transaction and route-owner cancellation. Async work must respect `signal`; any settled result is discarded if superseded, even if the underlying request ignored cancellation. Cancellation does not roll back completed server actions.
- Guards run in parent-to-child order and return allow/deny/redirect. Redirects are resolved before history or UI commit and have a bounded loop policy. Denied transitions do not commit, and a failed popstate traversal replaces the URL with the last committed URL. This is a conservative fallback, not a native history-index rollback.
- Async loaders and lazy imports run before page setup. Lazy imports are deduplicated by route identity; failures release the cache for later retry. Module imports cannot be aborted once initiated, but cancelled navigations never execute their page setup or publish their results.
- An unmatched path without a catch-all route raises `RouteNotFoundError`; lazy-import and loader failures surface `RouteModuleLoadError` and `RouteLoaderError` with the route ID and original cause.
- The route-state signals are `router.signals.{url,matches,params,search,hash,status,pending,error}`. `matches` exposes scoped owners and loaded data. UI subscriptions are granular; application providers are preserved.
- `attachOutlet(host)` is browser-specific; the matcher, route definitions, memory history, and `createRouter` itself access no `window`/`document` globals during module import. Route owners unmount child-first and resource cleanup runs before native DOM node removal.
- `createBrowserRestoration(window, { scroll, focus, announce })` runs after successful commits: auto top for forward navigation, native preserve on history traversal, decoded hash anchors, and optional caller-provided focus/accessible announcement hooks. No forced focus changes. It does not enable smooth scrolling, respecting reduced-motion preferences.

### Integration constraints and release gates

The public DOM package's `mount(factory, container)` creates a separate application owner. Router instead uses the **public Core owner lifecycle and public DOM/compiler ABI** through an explicit route page adapter; it does not invent a separate TSX renderer or attach a second app owner. The maintained `test/browser/App.tsx` and dynamically imported `test/browser/LazyPage.tsx` are compiled through the real CLI/Vite pipeline, mounted in nested native DOM outlets, and exercised by `.github/workflows/router-browser-matrix.yml` in **Chromium, Firefox and WebKit**. This is a dedicated merge acceptance check, not a claim that Router is published or SSR-ready. A page adapter currently returns one native root node; direct multi-root route pages and general-purpose SSR/hydration are outside this initial release.

The host server/CDN must serve the application's entry document for deep links and browser refreshes (SPA fallback), while preserving real asset files and HTTP status/SEO routes. Router alone cannot provide server-side 404 or SSR/SEO metadata responses.

## Integrate with neighboring packages

- [@zaakiyjs/core](./core.md)
- [@zaakiyjs/dom](./dom.md)
- [@zaakiyjs/async](./async.md)
- [@zaakiyjs/ssr](./ssr.md)

## Source and maintenance

- [Package README](https://github.com/sanukhandev/zaakiyjs/blob/9f6c6603c98ca566c2fed6fed34cc770f6a72960/packages/router/README.md)
- [Public source exports](https://github.com/sanukhandev/zaakiyjs/blob/9f6c6603c98ca566c2fed6fed34cc770f6a72960/packages/router/src/index.ts)
- [Package test cases](https://github.com/sanukhandev/zaakiyjs/tree/9f6c6603c98ca566c2fed6fed34cc770f6a72960/packages/router/test)
- Update this page when public APIs, runtime semantics or platform guarantees change.
