# @zaakiyjs/router

Client-side routing on ZaakiyJS Core owners and Signals. Independent of React, Vue, Angular, Zone.js, and a virtual DOM. **Prerelease (not yet published): merge eligibility is determined by the CI checks on the PR's latest head, including dedicated real-browser Router acceptance.**

## Core API

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

### Page adapters and MVVM

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

## Behavior contract

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

## Integration constraints and release gates

The public DOM package's `mount(factory, container)` creates a separate application owner. Router instead uses the **public Core owner lifecycle and public DOM/compiler ABI** through an explicit route page adapter; it does not invent a separate TSX renderer or attach a second app owner. The maintained `test/browser/App.tsx` and dynamically imported `test/browser/LazyPage.tsx` are compiled through the real CLI/Vite pipeline, mounted in nested native DOM outlets, and exercised by `.github/workflows/router-browser-matrix.yml` in **Chromium, Firefox and WebKit**. This is a dedicated merge acceptance check, not a claim that Router is published or SSR-ready. A page adapter currently returns one native root node; direct multi-root route pages and general-purpose SSR/hydration are outside this initial release.

The host server/CDN must serve the application's entry document for deep links and browser refreshes (SPA fallback), while preserving real asset files and HTTP status/SEO routes. Router alone cannot provide server-side 404 or SSR/SEO metadata responses.

## Development

```sh
pnpm --filter @zaakiyjs/router lint
pnpm --filter @zaakiyjs/router typecheck
pnpm --filter @zaakiyjs/router build
pnpm --filter @zaakiyjs/router test
pnpm --filter @zaakiyjs/router pack:check
```

The Router PR includes a reconciled frozen workspace lockfile and a narrow `scripts/ci/verify-workspaces.mjs` Router registration; existing foundation and other independent package checks remain mandatory. The package has **no compiler, network-client, AI, or external framework runtime dependency**. The compiler only runs at application build time. In addition to the package's Vitest unit/integration tests and ESM/npm-pack checks, the dedicated Router browser workflow verifies typed navigation, real TSX lowering, nested layout reuse, browser history, guards, redirects, lazy modules, abort races, injection resistance, and owner/listener cleanup. Always consult the latest workflow result before marking the PR ready.

The host server/CDN must implement SPA deep-link fallback for deployed apps. Actual HTTP 404/500 semantics, SSR/hydration, custom page transitions, and externally published npm installation are separate product/release work.
