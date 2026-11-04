import type { HistoryAdapter } from "./types.js";

/** Reads the browser only when the factory is invoked, never at module import. */
export function createBrowserHistory(source?: Window): HistoryAdapter {
  const win = source ?? window;
  return {
    current: () => win.location.pathname + win.location.search + win.location.hash,
    push: url => { win.history.pushState(null, "", url); },
    replace: url => { win.history.replaceState(null, "", url); },
    go: delta => { win.history.go(delta); },
    listen(callback) {
      win.addEventListener("popstate", callback);
      win.addEventListener("hashchange", callback);
      return () => {
        win.removeEventListener("popstate", callback);
        win.removeEventListener("hashchange", callback);
      };
    }
  };
}
/** Deterministic test/SSR adapter; does not access globals or patch History. */
export function createMemoryHistory(initial = "/"): HistoryAdapter & { entries(): readonly string[] } {
  const stack = [initial];
  let index = 0;
  const listeners = new Set<() => void>();
  const notify = (): void => { for (const listener of [...listeners]) listener(); };
  return {
    current: () => stack[index] ?? "/",
    push(url) { stack.splice(index + 1); stack.push(url); index = stack.length - 1; },
    replace(url) { stack[index] = url; },
    go(delta) {
      const next = Math.max(0, Math.min(stack.length - 1, index + delta));
      if (index !== next) { index = next; notify(); }
    },
    listen(callback) { listeners.add(callback); return () => { listeners.delete(callback); }; },
    entries: () => [...stack]
  };
}
