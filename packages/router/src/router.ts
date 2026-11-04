import {
  createOwner, disposeOwner, mountOwner, runWithOwner, onCleanup,
  useContext, requireContext
} from "@zaakiyjs/core";
import type { ContextToken, OwnerScope } from "@zaakiyjs/core";
import { batch, signal } from "@zaakiyjs/signals";
import { compileRoutes, matchRoutes, buildRoutePath } from "./match.js";
import type {
  ActiveRoute, CancellationReason, CompiledRoute, GuardDecision, HistoryAdapter,
  NavigationOptions, NavigationResult, PageAdapterContext, PageView,
  RouteContext, RouteDefinition, RouteMatch, RouteModule, RouteTarget, RouterOptions,
  RouterSignals
} from "./types.js";
import {
  NavigationCancelledError, NavigationDeniedError, RedirectLoopError,
  RouteConfigurationError, UnsafeNavigationError
} from "./types.js";

const ORIGIN = "https://zaakiy.invalid";
interface RuntimeEntry extends ActiveRoute {
  readonly abort: AbortController;
  readonly view?: PageView;
}
interface Transaction {
  readonly controller: AbortController;
  readonly id: number;
}
type VisitMode = "push" | "replace" | "none";

function basePath(value: string | undefined): string {
  const normalized = value ?? "/";
  if (!normalized.startsWith("/") || normalized.startsWith("//") ||
      normalized.includes("?") || normalized.includes("#") || normalized.includes("\\") ||
      normalized.split("/").some(x => x === ".." || x === ".")) {
    throw new RouteConfigurationError("Invalid application base: " + normalized);
  }
  return normalized.replace(/\/+$/, "") || "/";
}
function normalizeUrl(input: string, relativeTo: string): URL {
  if (!input || /[\u0000-\u001f\u007f\\]/.test(input) ||
      input.startsWith("//") || /^[A-Za-z][\w+.-]*:/.test(input)) {
    throw new UnsafeNavigationError("Navigation must target a safe same-origin application URL");
  }
  let url: URL;
  try { url = new URL(input, new URL(relativeTo, ORIGIN)); }
  catch { throw new UnsafeNavigationError("Malformed navigation URL"); }
  if (url.origin !== ORIGIN || url.username || url.password) {
    throw new UnsafeNavigationError("Cross-origin navigation is not supported");
  }
  return url;
}
function pathnameWithinBase(url: URL, base: string): string | null {
  if (base === "/") return url.pathname;
  if (url.pathname === base) return "/";
  return url.pathname.startsWith(base + "/") ? url.pathname.slice(base.length) : null;
}
function serialize(url: URL): string {
  return url.pathname + url.search + url.hash;
}
function paramsSame(a: Readonly<Record<string, string>>, b: Readonly<Record<string, string>>): boolean {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(key => a[key] === b[key]);
}
function prefixLength(previous: readonly RuntimeEntry[], next: readonly RouteMatch[], force: boolean, oldUrl: string, newUrl: string): number {
  if (force) return 0;
  let index = 0;
  for (; index < previous.length && index < next.length; index++) {
    const a = previous[index];
    const b = next[index];
    if (!a || !b || a.owner.disposed || a.route !== b.route ||
        a.pathname !== b.pathname || !paramsSame(a.params, b.params)) break;
  }
  // Query/hash changes reload only the leaf. Parent layouts remain stable.
  if (oldUrl !== newUrl && index === next.length && index > 0) index--;
  return index;
}
function abortReason(signal: AbortSignal): CancellationReason {
  const reason: unknown = signal.reason;
  if (reason === "superseded" || reason === "explicit" ||
      reason === "owner-disposed" || reason === "router-disposed") return reason;
  return "explicit";
}
function requireCurrent(tx: Transaction, current: Transaction | null, owner: OwnerScope): void {
  if (tx.controller.signal.aborted || tx !== current || owner.disposed) {
    throw new NavigationCancelledError(
      tx.controller.signal.aborted ? abortReason(tx.controller.signal) : "owner-disposed"
    );
  }
}
function decisionOf(value: GuardDecision): { kind: "allow" | "deny" | "redirect"; to?: string } {
  if (value === false || value === "deny") return { kind: "deny" };
  if (value === true || value === "allow") return { kind: "allow" };
  if ("redirect" in value) return { kind: "redirect", to: value.redirect };
  if (value.type === "redirect") return { kind: "redirect", to: value.to };
  return { kind: value.type };
}
function attachOwnerAbort(owner: OwnerScope, controller: AbortController): void {
  runWithOwner(owner, () => onCleanup(() => {
    if (!controller.signal.aborted) controller.abort("owner-disposed");
  }));
}
function createServices(owner: OwnerScope) {
  return {
    get<T>(token: ContextToken<T>): T | undefined { return useContext(owner, token); },
    require<T>(token: ContextToken<T>): T { return requireContext(owner, token); }
  };
}
function contextFor(
  entry: RuntimeEntry, from: URL, to: URL, signal: AbortSignal
): RouteContext {
  return {
    params: entry.params, search: new URLSearchParams(to.search), hash: to.hash,
    from, to, signal: AbortSignal.any([signal, entry.abort.signal]),
    owner: entry.owner, services: createServices(entry.owner)
  };
}
/** No ambient browser access. All history and DOM access is injected. */
export class Router {
  readonly signals: RouterSignals;
  private readonly table;
  private readonly base: string;
  private readonly maxRedirects: number;
  private readonly urlState = signal("/");
  private readonly matchesState = signal<readonly ActiveRoute[]>([]);
  private readonly paramsState = signal<Readonly<Record<string, string>>>({});
  private readonly searchState = signal(new URLSearchParams());
  private readonly hashState = signal("");
  private readonly statusState = signal<"idle" | "loading" | "blocked" | "error">("idle");
  private readonly pendingState = signal<string | null>(null);
  private readonly errorState = signal<unknown>(null);
  private readonly moduleCache = new Map<string, Promise<RouteModule>>();
  private readonly subscribers = new Set<(entries: readonly ActiveRoute[]) => void>();
  private active: RuntimeEntry[] = [];
  private current: Transaction | null = null;
  private nextId = 0;
  private listening: (() => void) | null = null;
  private starting: Promise<NavigationResult> | null = null;
  private disposed = false;
  private host: Element | null = null;

  constructor(private readonly options: RouterOptions) {
    if (options.owner.disposed) throw new Error("Cannot create router in disposed application owner");
    this.table = compileRoutes(options.routes);
    this.base = basePath(options.base);
    this.maxRedirects = options.maxRedirects ?? 16;
    if (!Number.isSafeInteger(this.maxRedirects) || this.maxRedirects < 1 || this.maxRedirects > 64) {
      throw new RouteConfigurationError("maxRedirects must be between 1 and 64");
    }
    this.urlState.value = serialize(normalizeUrl(options.history.current(), ORIGIN + "/"));
    this.signals = {
      url: this.urlState, matches: this.matchesState, params: this.paramsState,
      search: this.searchState, hash: this.hashState, status: this.statusState,
      pending: this.pendingState, error: this.errorState
    };
    runWithOwner(options.owner, () => onCleanup(() => this.dispose()));
  }

  /** Attaches a single native-DOM outlet. Call before start/navigation. */
  attachOutlet(host: Element): void {
    if (this.disposed || this.current || this.active.length > 0) {
      throw new Error("Attach route outlet before navigation");
    }
    if (this.host) throw new Error("A route outlet is already attached");
    this.host = host;
  }

  /** Subscribe without reactive tracking (e.g., explicit accessibility adapter). */
  subscribe(listener: (entries: readonly ActiveRoute[]) => void): () => void {
    if (this.disposed) throw new Error("Router disposed");
    this.subscribers.add(listener);
    return () => { this.subscribers.delete(listener); };
  }

  /** Idempotent: exactly one popstate/hashchange listener per router. */
  start(): Promise<NavigationResult> {
    if (this.disposed) return Promise.reject(new Error("Router disposed"));
    if (this.starting) return this.starting;
    this.listening = this.options.history.listen(() => {
      void this.transition(this.options.history.current(), { history: "none" }, true)
        .catch(() => { /* error is published to signals.error */ });
    });
    this.starting = this.transition(this.options.history.current(), { history: "none" }, true);
    return this.starting;
  }

  href<P extends string>(target: RouteTarget<P>): string {
    const entry = this.table.byId.get(target.route.id);
    if (!entry || entry.route !== target.route) throw new RouteConfigurationError("Route is not registered: " + target.route.id);
    const path = buildRoutePath(entry, target.params);
    const search = target.search instanceof URLSearchParams ? target.search.toString()
      : typeof target.search === "string" ? target.search.replace(/^\?/, "")
      : target.search ? new URLSearchParams(target.search).toString() : "";
    const hash = target.hash ? "#" + encodeURIComponent(target.hash.replace(/^#/, "")) : "";
    return (this.base === "/" ? "" : this.base) + path + (search ? "?" + search : "") + hash;
  }

  navigate<P extends string>(target: string | RouteTarget<P>, options: NavigationOptions = {}): Promise<NavigationResult> {
    const value = typeof target === "string" ? target : this.href(target);
    return this.transition(value, options, false);
  }

  back(): void { this.options.history.go(-1); }
  forward(): void { this.options.history.go(1); }
  cancel(reason: CancellationReason = "explicit"): void {
    if (this.current && !this.current.controller.signal.aborted) this.current.controller.abort(reason);
  }
  private moduleFor(entry: CompiledRoute): Promise<RouteModule | undefined> {
    if (!entry.route.lazy) return Promise.resolve(undefined);
    let pending = this.moduleCache.get(entry.route.id);
    if (!pending) {
      // Import is shared, but page setup is never executed for a superseded navigation.
      pending = Promise.resolve().then(() => entry.route.lazy!());
      this.moduleCache.set(entry.route.id, pending);
      void pending.catch(() => { if (this.moduleCache.get(entry.route.id) === pending) this.moduleCache.delete(entry.route.id); });
    }
    return pending;
  }

  private prepareView(next: RuntimeEntry[], common: number, from: URL, to: URL, signal: AbortSignal): () => void {
    if (!this.host) return () => {};
    const host = this.host;
    const doc = host.ownerDocument;
    const staging = doc.createDocumentFragment();
    let target: Node = staging;
    if (common > 0) {
      const ancestor = next[common - 1];
      if (ancestor?.view) {
        if (!ancestor.view.outlet) throw new RouteConfigurationError("Parent adapter has no nested outlet: " + ancestor.route.id);
        target = ancestor.view.outlet;
      } else {
        for (let i = common - 2; i >= 0; i--) {
          const parent = next[i];
          if (parent?.view) {
            if (!parent.view.outlet) throw new RouteConfigurationError("Parent adapter has no nested outlet: " + parent.route.id);
            target = parent.view.outlet;
            break;
          }
        }
        if (target === staging) target = host;
      }
    }
    // Never mutate the live tree during staging; use a detached fragment even
    // when the retained parent layout already has a connected child outlet.
    const finalTarget = target === staging ? host : target;
    target = staging;
    for (let i = common; i < next.length; i++) {
      const entry = next[i]!;
      const adapter = entry.module?.adapter ?? entry.route.adapter;
      if (!adapter) continue;
      const context: PageAdapterContext = { ...contextFor(entry, from, to, signal), data: entry.data, metadata: entry.route.metadata ?? {} };
      const model = adapter.setup ? runWithOwner(entry.owner, () => adapter.setup!(context)) : undefined;
      if (model instanceof Promise) throw new TypeError("Page adapter setup must be synchronous");
      const view = runWithOwner(entry.owner, () => adapter.render(model, context));
      if (!view || !view.node || typeof view.node.nodeType !== "number" || view.node.nodeType === 11) {
        throw new TypeError("Page adapter must return a single native DOM node (not a fragment)");
      }
      if (view.outlet && !(view.node === view.outlet || view.node.contains(view.outlet))) {
        throw new TypeError("Nested outlet must be contained in the adapter root node");
      }
      (entry as { view?: PageView }).view = view;
      target.appendChild(view.node);
      if (i < next.length - 1) {
        if (!view.outlet) throw new RouteConfigurationError("Nested layout requires an outlet: " + entry.route.id);
        target = view.outlet;
      }
    }
    return () => {
      // Dispose removed route owners before detaching their DOM, preserving
      // provider visibility during teardown. Reused layouts remain untouched.
      for (let i = this.active.length - 1; i >= common; i--) {
        const entry = this.active[i];
        if (!entry) continue;
        try { disposeOwner(entry.owner); } finally { entry.view?.node.parentNode?.removeChild(entry.view.node); }
      }
      finalTarget.appendChild(staging);
      if (next[common]) mountOwner(next[common].owner);
    };
  }

  private async transition(raw: string, options: NavigationOptions, isPop: boolean): Promise<NavigationResult> {
    if (this.disposed) throw new Error("Router disposed");
    const historyMode: VisitMode = options.history ?? (isPop ? "none" : "push");
    const tx: Transaction = { controller: new AbortController(), id: ++this.nextId };
    this.current?.controller.abort("superseded");
    this.current = tx;
    const from = normalizeUrl(this.urlState.peek(), ORIGIN + "/");
    let to = normalizeUrl(raw, serialize(from));
    const committedUrl = serialize(from);
    const attemptedUrl = serialize(to);
    if (attemptedUrl === committedUrl && this.active.length > 0 && !options.force) {
      this.current = null;
      this.statusState.value = "idle";
      this.pendingState.value = null;
      return { status: "committed", url: committedUrl };
    }
    batch(() => { this.statusState.value = "loading"; this.pendingState.value = attemptedUrl; this.errorState.value = null; });
    const visited = new Set<string>();
    let staged: RuntimeEntry[] = [];
    let next: RuntimeEntry[] = [];
    let common = 0;
    try {
      for (let redirects = 0;; redirects++) {
        requireCurrent(tx, this.current, this.options.owner);
        if (redirects > this.maxRedirects || visited.has(serialize(to))) throw new RedirectLoopError("Route guard redirect loop");
        visited.add(serialize(to));
        const localPath = pathnameWithinBase(to, this.base);
        if (localPath === null) throw new UnsafeNavigationError("Navigation outside configured application base");
        const matches = matchRoutes(this.table, localPath);
        common = prefixLength(this.active, matches, options.force ?? false, committedUrl, serialize(to));
        staged = [];
        next = [...this.active.slice(0, common)];
        for (let i = common; i < matches.length; i++) {
          const m = matches[i]!;
          const parent = next[i - 1]?.owner ?? this.options.owner;
          const owner = createOwner(parent);
          const abort = new AbortController();
          attachOwnerAbort(owner, abort);
          const record: RuntimeEntry = { ...m, owner, abort, data: undefined, module: undefined };
          staged.push(record);
          next.push(record);
        }
        let redirect: string | undefined;
        try {
          for (const entry of next) {
            requireCurrent(tx, this.current, this.options.owner);
            if (entry.owner.disposed) throw new NavigationCancelledError("owner-disposed");
            const guard = entry.route.guard;
            if (!guard) continue;
            const verdict = decisionOf(await guard(contextFor(entry, from, to, tx.controller.signal)));
            requireCurrent(tx, this.current, this.options.owner);
            if (verdict.kind === "deny") throw new NavigationDeniedError("Guard denied route: " + entry.route.id);
            if (verdict.kind === "redirect") { redirect = verdict.to; break; }
          }
          if (redirect === undefined) {
            for (let i = common; i < next.length; i++) {
              const entry = next[i]!;
              const compiled = this.table.byId.get(entry.route.id)!;
              const module = await this.moduleFor(compiled);
              requireCurrent(tx, this.current, this.options.owner);
              if (entry.owner.disposed) throw new NavigationCancelledError("owner-disposed");
              (entry as { module?: RouteModule }).module = module;
              const loader = module?.loader ?? entry.route.loader;
              if (loader) {
                (entry as { data: unknown }).data = await loader(contextFor(entry, from, to, tx.controller.signal));
                requireCurrent(tx, this.current, this.options.owner);
                if (entry.owner.disposed) throw new NavigationCancelledError("owner-disposed");
              }
            }
          }
        } catch (error) {
          for (const entry of [...staged].reverse()) disposeOwner(entry.owner);
          staged = [];
          throw error;
        }
        if (redirect === undefined) break;
        for (const entry of [...staged].reverse()) disposeOwner(entry.owner);
        staged = [];
        to = normalizeUrl(redirect, serialize(to));
        this.pendingState.value = serialize(to);
      }
      requireCurrent(tx, this.current, this.options.owner);
      const applyView = this.prepareView(next, common, from, to, tx.controller.signal);
      requireCurrent(tx, this.current, this.options.owner);
      if (this.host) {
        applyView();
      } else {
        for (let i = this.active.length - 1; i >= common; i--) disposeOwner(this.active[i]!.owner);
        if (next[common]) mountOwner(next[common].owner);
      }
      staged = [];
      this.active = next;
      const destination = serialize(to);
      if (!isPop) {
        if (historyMode === "push") this.options.history.push(destination);
        else if (historyMode === "replace") this.options.history.replace(destination);
      }
      batch(() => {
        this.urlState.value = destination;
        this.matchesState.value = [...this.active];
        this.paramsState.value = this.active.at(-1)?.params ?? {};
        this.searchState.value = new URLSearchParams(to.search);
        this.hashState.value = to.hash;
        this.statusState.value = "idle";
        this.pendingState.value = null;
        this.errorState.value = null;
      });
      this.current = null;
      for (const subscriber of [...this.subscribers]) {
        try { subscriber(this.matchesState.peek()); }
        catch (error) { this.errorState.value = error; }
      }
      try { this.options.onNavigate?.({ url: destination, matches: this.matchesState.peek(), isPop }); }
      catch (error) { this.errorState.value = error; }
      return { status: "committed", url: destination };
    } catch (error) {
      for (const entry of [...staged].reverse()) {
        if (!entry.owner.disposed) {
          try { disposeOwner(entry.owner); } catch { /* Preserve navigation failure */ }
        }
      }
      const cancelled = error instanceof NavigationCancelledError || tx.controller.signal.aborted;
      if (this.current === tx && !this.disposed) {
        this.current = null;
        if (isPop) this.options.history.replace(committedUrl);
        batch(() => {
          this.pendingState.value = null;
          this.statusState.value = cancelled ? "idle" : error instanceof NavigationDeniedError ? "blocked" : "error";
          this.errorState.value = cancelled ? null : error;
        });
      }
      if (cancelled) return { status: "cancelled", url: committedUrl };
      if (error instanceof NavigationDeniedError) return { status: "blocked", url: committedUrl };
      throw error;
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.current?.controller.abort("router-disposed");
    this.current = null;
    this.listening?.();
    this.listening = null;
    this.subscribers.clear();
    for (const entry of [...this.active].reverse()) {
      try { disposeOwner(entry.owner); }
      finally { entry.view?.node.parentNode?.removeChild(entry.view.node); }
    }
    this.active = [];
    this.moduleCache.clear();
  }
}
export function createRouter(options: RouterOptions): Router { return new Router(options); }
