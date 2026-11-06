import type { Analytics } from "./types.js";
import { safePath } from "./privacy.js";

/** Shape matches Router's public Router.signals and Router.subscribe APIs. */
export interface RouterNavigationSource {
  readonly signals: {
    readonly url: { peek(): string };
    readonly matches: { peek(): readonly { readonly route: { readonly id: string } }[] };
  };
  subscribe(callback: (matches: readonly { readonly route: { readonly id: string } }[]) => void): () => void;
}
export interface RouterTrackingOptions {
  /** If true, records the already committed initial route once on attachment. */
  readonly initialPageview?: boolean;
  /** Caller may supply hydration-deduplication route key. */
  readonly previouslyReportedRoute?: string;
  readonly registerCleanup?: (cleanup: () => void) => void;
}
/** Reads only committed Router events; does not observe History, pending or failed navigation. */
export function trackRouter(
  analytics: Pick<Analytics<Record<string, never>>, "pageview">,
  router: RouterNavigationSource,
  options: RouterTrackingOptions = {}
): () => void {
  let last = options.previouslyReportedRoute;
  let active = true;
  const report = (matches: readonly { readonly route: { readonly id: string } }[]) => {
    if (!active || matches.length === 0) return;
    const path = safePath(router.signals.url.peek());
    const routeId = matches[matches.length - 1]?.route.id;
    if (!routeId) return;
    const key = `${path}|${routeId}`;
    if (key === last) return;
    last = key;
    analytics.pageview({ path, routeId });
  };
  const off = router.subscribe(report);
  if (options.initialPageview) report(router.signals.matches.peek());
  const dispose = () => { if (!active) return; active = false; off(); };
  options.registerCleanup?.(dispose);
  return dispose;
}
