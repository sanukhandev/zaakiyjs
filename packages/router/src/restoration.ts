import type { ActiveRoute } from "./types.js";

export interface RestorationContext {
  readonly url: string;
  readonly matches: readonly ActiveRoute[];
  readonly isPop: boolean;
}
export interface BrowserRestorationOptions {
  /** Preserve native history scroll on traversal; new pages scroll to top. */
  readonly scroll?: "auto" | "top" | "preserve" | "manual";
  /** Called only after successful route commit; no automatic focus stealing. */
  readonly focus?: (context: RestorationContext, document: Document) => void;
  /** App-supplied live-region or screen-reader adapter. */
  readonly announce?: (context: RestorationContext) => void;
}
/**
 * Browser-only navigation effects. Invoke at application setup and pass the
 * returned callback to createRouter({ onNavigate }). Nothing runs at import.
 */
export function createBrowserRestoration(
  source?: Window, options: BrowserRestorationOptions = {}
): (context: RestorationContext) => void {
  const win = source ?? window;
  return context => {
    const url = new URL(context.url, win.location.origin);
    const behavior = options.scroll ?? "auto";
    if (behavior !== "manual") {
      if (url.hash) {
        let id: string;
        try { id = decodeURIComponent(url.hash.slice(1)); }
        catch { id = url.hash.slice(1); }
        const anchor = win.document.getElementById(id);
        anchor?.scrollIntoView({ behavior: "auto", block: "start" });
      } else if (behavior === "top" || (behavior === "auto" && !context.isPop)) {
        win.scrollTo({ top: 0, left: 0, behavior: "auto" });
      }
      // 'preserve' deliberately leaves scroll state to browser/application.
    }
    options.focus?.(context, win.document);
    options.announce?.(context);
  };
}
