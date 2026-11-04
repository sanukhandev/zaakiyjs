# @zaakiyjs/router

Client-side routing on ZaakiyJS Core owners and Signals. Independent of React, Vue, Angular, Zone.js, and a virtual DOM. **Prerelease: this package has not passed cross-package/browser acceptance.**

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

The identifiers `productRepositoryToken`, `createProductViewModel`, and `renderCompiledProductView` in this conceptual example are **application-defined**, not Router exports. Rendering adapters must return one native root node; `DocumentFragment` and automatic multi-root route mounting are not yet supported. When a page has a rendered nested child, it must return an `outlet`.

## Behavior contract

- Routes compile to a deterministic, pure path table. Literal segments outrank `:params`, terminal `*` is the fallback, and unsupported optional/splat grammar throws. Duplicate IDs and ambiguous route patterns fail at registration. Empty-path index children may share their parent layout's URL.
- `base` confines routing to an app path. Navigation accepts safe relative or same-app absolute path strings, or registered typed targets. External/protocol-relative, script-scheme, malformed, and out-of-base destinations throw. Client guards are **not server authorization**.
- `start()` is idempotent and registers one `popstate`/`hashchange` subscription. `navigate(url, { history: "push" | "replace" | "none", force?: boolean })`, `back()`, `forward()`, `cancel()`, and `dispose()` manage routing explicitly. `force` reinitializes a destination; identical URLs otherwise do not remount.
- Every navigation has a native AbortController; newer navigation aborts the prior transaction. Guard/loader context signals combine transaction and route-owner cancellation. Async work must respect `signal`; any settled result is discarded if superseded, even if the underlying request ignored cancellation. Cancellation does not roll back completed server actions.
- Guards run in parent-to-child order and return allow/deny/redirect. Redirects are resolved before history or UI commit and have a bounded loop policy. Denied transitions do not commit, and a failed popstate traversal replaces the URL with the last committed URL. This is a conservative fallback, not a native history-index rollback.
- Async loaders and lazy imports run before page setup. Lazy imports are deduplicated by route identity; failures release the cache for later retry. Module imports cannot be aborted once initiated, but cancelled navigations never execute their page setup or publish their results.
- The route-state signals are `router.signals.{url,matches,params,search,hash,status,pending,error}`. `matches` exposes scoped owners and loaded data. UI subscriptions are granular; application providers are preserved.
- `attachOutlet(host)` is browser-specific; the matcher, route definitions, memory history, and `createRouter` itself access no `window`/`document` globals during module import. Route owners unmount child-first and resource cleanup runs before native DOM node removal.
- `createBrowserRestoration(window, { scroll, focus, announce })` runs after successful commits: auto top for forward navigation, native preserve on history traversal, decoded hash anchors, and optional caller-provided focus/accessible announcement hooks. No forced focus changes. It does not enable smooth scrolling, respecting reduced-motion preferences.

## Integration constraints and release gates

The current DOM package's `mount(factory, container)` always creates a new application owner; it cannot mount directly into a preexisting route owner. Router therefore uses the *actual* Core owner/mount lifecycle and native DOM insertion through an explicit page adapter, without inventing a compiler or DOM helper. End-to-end compiled TSX route factories, multi-root pages, nested route transitions under the compiler, and Firefox/WebKit behavior require a coordinated DOM/compiler integration design and browser tests before stable release.

The host server/CDN must serve the application's entry document for deep links and browser refreshes (SPA fallback), while preserving real asset files and HTTP status/SEO routes. Router alone cannot provide server-side 404 or SSR/SEO metadata responses.

## Development

```sh
pnpm --filter @zaakiyjs/router lint
pnpm --filter @zaakiyjs/router typecheck
pnpm --filter @zaakiyjs/router build
pnpm --filter @zaakiyjs/router test
pnpm --filter @zaakiyjs/router pack:check
```

**PR integration follow-up:** registering a new workspace package requires a coordinated regeneration of the root `pnpm-lock.yaml` for frozen installations. This branch intentionally does not edit root workspace files. CI installation may fail until the lockfile is updated by the integration owner.

The package has no compiler, network client, AI, or framework-renderer dependencies. Browser History integration, cancellation, scope disposal, source-level TSX typing, and end-to-end compiled route mounting remain explicit acceptance gates rather than unverified claims.
