import { createContext, createOwner, disposeOwner, onCleanup, onMount, provide } from "@zaakiyjs/core";
import { signal } from "@zaakiyjs/signals";
import { createBrowserHistory, createBrowserRestoration, createRouter, definePageAdapter, defineRoute } from "@zaakiyjs/router";
import type { PageAdapter, Router, NavigationResult } from "@zaakiyjs/router";

const Repository = createContext<{ label(id: string): string }>("router-browser-repository");

export interface RouterBrowserMetrics {
  shellSetup: number;
  shellCleanup: number;
  productSetup: number;
  productCleanup: number;
  productMount: number;
  lazySetup: number;
  lazyCleanup: number;
  slowAborts: number;
  announcements: string[];
}

export const metrics: RouterBrowserMetrics = {
  shellSetup: 0, shellCleanup: 0,
  productSetup: 0, productCleanup: 0, productMount: 0,
  lazySetup: 0, lazyCleanup: 0, slowAborts: 0,
  announcements: []
};

const product = defineRoute({
  id: "product",
  path: "products/:id",
  loader: ({ params, services }) => Promise.resolve({
    label: services.require(Repository).label(params.id)
  }),
  adapter: definePageAdapter<{ id: string }, { id: string; counter: ReturnType<typeof signal<number>> }, { label: string }>({
    setup({ params }) {
      metrics.productSetup++;
      onMount(() => { metrics.productMount++; });
      onCleanup(() => { metrics.productCleanup++; });
      return { id: params.id, counter: signal(0) };
    },
    render(model, context) {
      // This is real TSX lowered by @zaakiyjs/compiler and the production Vite plugin.
      // All dynamic bindings and listeners must be owned by the route scope.
      const node = (
        <article id="product-page" data-product-id={model.id}>
          <h2 id="product-heading">{context.data.label}</h2>
          <p id="safe-param">{model.id}</p>
          <input id="product-input" aria-label="Product notes" value="draft" />
          <button id="increment" type="button" onClick={() => { model.counter.value++; }}>
            Count: {model.counter.value}
          </button>
          <p id="query-value">Query: {context.search.get("q") ?? "-"}</p>
        </article>
      ) as unknown as HTMLElement;
      return { node };
    }
  })
});

export function bootstrapRouter(host: Element): {
  readonly router: Router;
  readonly ready: Promise<NavigationResult>;
  readonly metrics: RouterBrowserMetrics;
  readonly href: (id: string) => string;
  navigate(to: string): Promise<NavigationResult>;
  back(): void;
  forward(): void;
  dispose(): void;
} {
  const appOwner = createOwner();
  provide(appOwner, Repository, { label: id => "Product " + id });
  const shell: PageAdapter = {
    setup() {
      metrics.shellSetup++;
      onCleanup(() => { metrics.shellCleanup++; });
    },
    render() {
      const node = (
        <section id="router-shell">
          <h1>ZaakiyJS Router acceptance</h1>
          <nav aria-label="Site navigation">
            <button id="nav-home" type="button" onClick={() => { void router.navigate("/app/"); }}>Home</button>
            <button id="nav-product" type="button" onClick={() => { void router.navigate(router.href({ route: product, params: { id: "alpha" } })); }}>Product</button>
            <button id="nav-lazy" type="button" onClick={() => { void router.navigate("/app/lazy"); }}>Lazy</button>
          </nav>
          <div id="route-outlet"></div>
        </section>
      ) as unknown as HTMLElement;
      const outlet = node.querySelector("#route-outlet");
      if (!outlet) throw new Error("Compiled shell is missing #route-outlet");
      return { node, outlet };
    }
  };

  const router = createRouter({
    owner: appOwner,
    history: createBrowserHistory(window),
    base: "/app",
    routes: [
      {
        id: "shell", path: "/", adapter: shell,
        children: [
          { id: "home", path: "", adapter: {
            render: () => ({ node: (<main id="home-page"><h2>Home page</h2></main>) as unknown as Node })
          } },
          product,
          { id: "blocked", path: "blocked", guard: () => false },
          { id: "redirect", path: "redirect", guard: () => ({ redirect: "/app/products/redirected" }) },
          { id: "slow", path: "slow", loader: ({ signal }) => new Promise(resolve => {
            const timer = setTimeout(() => resolve("too late"), 600);
            signal.addEventListener("abort", () => {
              metrics.slowAborts++;
              clearTimeout(timer);
              resolve("cancelled");
            }, { once: true });
          }) },
          { id: "lazy", path: "lazy", lazy: () => import("./LazyPage") },
          { id: "not-found", path: "*", adapter: {
            render: () => ({ node: (<main id="not-found"><h2>Not found</h2></main>) as unknown as Node })
          } }
        ]
      }
    ],
    onNavigate: createBrowserRestoration(window, {
      scroll: "manual",
      announce: ({ url }) => { metrics.announcements.push(url); }
    })
  });
  router.attachOutlet(host);
  const ready = router.start();
  let closed = false;
  return {
    router, ready, metrics,
    href: id => router.href({ route: product, params: { id } }),
    navigate: to => router.navigate(to),
    back: () => router.back(),
    forward: () => router.forward(),
    dispose() {
      if (closed) return;
      closed = true;
      try { router.dispose(); }
      finally { disposeOwner(appOwner); }
    }
  };
}
