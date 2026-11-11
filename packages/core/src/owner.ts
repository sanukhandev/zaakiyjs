/** Synchronous, tree-scoped component/resource ownership. No async context patches. */
export type OwnerState =
  | "created" | "initialized" | "mounted" | "active"
  | "deactivated" | "suspended" | "disposed";

export type Cleanup = () => void;

export interface OwnerScope {
  readonly parent: OwnerScope | null;
  readonly state: OwnerState;
  readonly disposed: boolean;
  dispose(): void;
}

let currentOwner: OwnerScope | null = null;

class Scope implements OwnerScope {
  parent: Scope | null;
  state: OwnerState = "created";
  private readonly children = new Set<Scope>();
  private readonly cleanups: Cleanup[] = [];
  private readonly mountCallbacks: Cleanup[] = [];
  // Most component scopes never provide dependencies. Allocate on first use.
  private providerStore: Map<symbol, unknown> | null = null;
  get providers(): Map<symbol, unknown> {
    return this.providerStore ??= new Map<symbol, unknown>();
  }
  componentInitialized = false;
  /** Provider reads remain valid while teardown callbacks execute. */
  private cleanupInProgress = false;
  /** A descendant may request ancestor disposal while its own cleanup is running. */
  private disposeRequested = false;

  constructor(parent: Scope | null) {
    this.parent = parent;
    parent?.children.add(this);
  }

  get disposed(): boolean {
    return this.disposeRequested || this.state === "disposed";
  }

  addCleanup(cleanup: Cleanup): void {
    this.ensureAlive();
    this.cleanups.push(cleanup);
  }

  addMount(callback: Cleanup): void {
    this.ensureAlive();
    if (this.state !== "created" && this.state !== "initialized") {
      throw new Error("Mount callbacks must be registered before mounting");
    }
    this.mountCallbacks.push(callback);
  }

  ensureAlive(): void {
    if (this.disposed) throw new Error("Owner has been disposed");
  }

  /** Read-only context access is permitted during cleanup, not after it. */
  ensureReadable(): void {
    // Pending ancestor disposal must keep providers readable until descendant
    // teardown completes, even though new registrations are already blocked.
    if (this.state === "disposed" && !this.cleanupInProgress) {
      throw new Error("Owner has been disposed");
    }
  }

  initialize(): void {
    this.ensureAlive();
    if (this.state === "created") this.state = "initialized";
  }

  mount(): void {
    this.ensureAlive();
    if (this.state === "active") return; // A parent may mount a child already mounted by DOM.
    if (this.state !== "created" && this.state !== "initialized") {
      throw new Error("Owner can only mount once");
    }
    try {
      // Mount descendants before ancestors, after the DOM subtree has been inserted.
      // Dynamic owners created later must be mounted explicitly by the DOM adapter.
      for (const child of [...this.children]) {
        if (child.disposed) continue;
        if (child.state === "created" || child.state === "initialized") {
          child.mount();
        }
        if (this.disposed) return;
      }
      this.state = "mounted";
      const callbacks = this.mountCallbacks.splice(0);
      for (const callback of callbacks) {
        runWithOwner(this, callback);
        if (this.disposed) return;
      }
      this.state = "active";
    } catch (error) {
      throw cleanupAfterFailure(this, error);
    }
  }

  transition(expected: OwnerState | readonly OwnerState[], next: OwnerState): void {
    this.ensureAlive();
    const states = Array.isArray(expected) ? expected : [expected];
    if (!states.includes(this.state)) {
      throw new Error("Invalid owner transition: " + this.state + " -> " + next);
    }
    this.state = next;
  }

  transferTo(parent: Scope): void {
    this.ensureAlive();
    parent.ensureAlive();
    if (this.parent === null) throw new Error("Cannot transfer a root owner");
    if (rootOf(this) !== rootOf(parent)) throw new Error("Cannot transfer across application roots");
    for (let cursor: Scope | null = parent; cursor; cursor = cursor.parent) {
      if (cursor === this) throw new Error("Owner transfer would create a cycle");
    }
    if (this.parent === parent) return;
    this.parent.children.delete(this);
    this.parent = parent;
    parent.children.add(this);
  }

  /** True if a descendant is executing cleanup and still needs our providers. */
  private hasActiveDescendantCleanup(): boolean {
    for (const child of this.children) {
      if (child.cleanupInProgress || child.hasActiveDescendantCleanup()) return true;
    }
    return false;
  }

  /** Complete an ancestor's deferred teardown after the last child finishes. */
  private finishDeferredDisposal(): void {
    if (this.disposeRequested && this.state !== "disposed" && !this.hasActiveDescendantCleanup()) {
      this.dispose();
    }
  }

  dispose(): void {
    if (this.state === "disposed") return;
    this.disposeRequested = true;
    // A child-first disposal can synchronously request its ancestor's teardown.
    // Deferring parent cleanup prevents clearing providers before all child
    // cleanup callbacks finish. All new registrations are already rejected.
    if (this.hasActiveDescendantCleanup()) return;
    // Reject all new registrations immediately, but permit existing providers
    // to be read while owner and descendant cleanup callbacks run.
    this.state = "disposed";
    this.cleanupInProgress = true;
    const errors: unknown[] = [];
    try {
      const children = [...this.children].reverse();
      this.children.clear();
      for (const child of children) {
        try { child.dispose(); } catch (error) { errors.push(error); }
      }
      this.mountCallbacks.length = 0;
      for (let index = this.cleanups.length - 1; index >= 0; index--) {
        try {
          // A teardown always runs in its own lexical owner, never the caller's.
          // Registration remains forbidden because this scope is already disposed.
          withLexicalOwner(this, () => this.cleanups[index]?.());
        } catch (error) { errors.push(error); }
      }
    } finally {
      // Ancestry and provider values must survive through the last cleanup,
      // including child cleanup when an ancestor is already disposing.
      this.mountCallbacks.length = 0;
      this.cleanups.length = 0;
      this.providerStore?.clear();
      this.providerStore = null;
      const parent = this.parent;
      // Capture the complete ancestry before severing this link. A teardown
      // request can be pending on a grandparent even if the intermediate
      // parent itself was never asked to dispose.
      const ancestors: Scope[] = [];
      for (let cursor = parent; cursor !== null; cursor = cursor.parent) {
        ancestors.push(cursor);
      }
      parent?.children.delete(this);
      this.parent = null; // Retained disposed scopes must not retain their app.
      this.cleanupInProgress = false;
      // Every pending ancestor now gets a chance to finish, child-first.
      // Any cleanup failures are aggregated with the original disposal errors.
      for (const ancestor of ancestors) {
        try { ancestor.finishDeferredDisposal(); } catch (error) { errors.push(error); }
      }
    }
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) throw new AggregateError(errors, "Owner disposal failed");
  }
}

function rootOf(scope: Scope): Scope {
  let root = scope;
  while (root.parent) root = root.parent;
  return root;
}

function asScope(owner: OwnerScope): Scope {
  if (!(owner instanceof Scope)) {
    throw new TypeError("Expected an owner created by @zaakiyjs/core");
  }
  return owner;
}

export function assertLiveOwner(owner: OwnerScope): void {
  asScope(owner).ensureAlive();
}

/** Context lookup only: does not authorize registrations on a disposing owner. */
export function assertReadableOwner(owner: OwnerScope): void {
  asScope(owner).ensureReadable();
}

export function createOwner(parent: OwnerScope | null = null): OwnerScope {
  const parentScope = parent === null ? null : asScope(parent);
  parentScope?.ensureAlive();
  return new Scope(parentScope);
}

/** Set a synchronous lexical owner without permitting new setup on disposed scopes. */
function withLexicalOwner<T>(owner: OwnerScope, callback: () => T): T {
  const previous = currentOwner;
  currentOwner = owner;
  try { return callback(); } finally { currentOwner = previous; }
}

/** Lexical context is synchronous: it does not flow across await/Promise callbacks. */
export function runWithOwner<T>(owner: OwnerScope, initialize: () => T): T {
  const scope = asScope(owner);
  scope.ensureAlive();
  return withLexicalOwner(scope, initialize);
}

export function getOwner(): OwnerScope | null {
  return currentOwner;
}

/** Reject registration outside an active lexical owner. */
export function onCleanup(dispose: Cleanup): void {
  if (!currentOwner) throw new Error("onCleanup requires runWithOwner");
  asScope(currentOwner).addCleanup(dispose);
}

export function onMount(callback: () => void): void {
  if (!currentOwner) throw new Error("onMount requires runWithOwner");
  asScope(currentOwner).addMount(callback);
}

export function mountOwner(owner: OwnerScope): void {
  asScope(owner).mount();
}

export function deactivateOwner(owner: OwnerScope): void {
  asScope(owner).transition("active", "deactivated");
}

/** State annotation only. Does not pause timers, effects or resources. */
export function suspendOwner(owner: OwnerScope): void {
  asScope(owner).transition("active", "suspended");
}

export function activateOwner(owner: OwnerScope): void {
  asScope(owner).transition(["deactivated", "suspended"], "active");
}

export function transferOwner(owner: OwnerScope, parent: OwnerScope): void {
  asScope(owner).transferTo(asScope(parent));
}

export function disposeOwner(owner: OwnerScope): void {
  asScope(owner).dispose();
}

/** Register an independently-created resource handle for deterministic disposal. */
export function ownDisposable<T extends { dispose(): void }>(handle: T): T {
  try {
    onCleanup(() => handle.dispose());
  } catch (error) {
    try { handle.dispose(); } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], "Failed to adopt resource");
    }
    throw error;
  }
  return handle;
}

/** Create and own a signal effect without coupling signals back to Core.
 * Caller supplies the public signals.effect invocation. The factory never runs
 * without an active, live lexical owner. */
export function ownEffect<T extends { dispose(): void }>(create: () => T): T {
  if (!currentOwner) throw new Error("ownEffect requires runWithOwner");
  asScope(currentOwner).ensureAlive();
  return ownDisposable(create());
}

export function initializeOwnedComponent<T>(
  owner: OwnerScope,
  initialize: () => T
): T {
  const scope = asScope(owner);
  scope.ensureAlive();
  if (scope.componentInitialized) throw new Error("Component already initialized for this owner");
  if (scope.state !== "created") throw new Error("Component requires a new owner");
  scope.componentInitialized = true;
  scope.initialize();
  try { return runWithOwner(scope, initialize); }
  catch (error) { throw cleanupAfterFailure(scope, error); }
}

function cleanupAfterFailure(scope: Scope, reason: unknown): unknown {
  try { scope.dispose(); return reason; }
  catch (cleanupError) {
    return new AggregateError([reason, cleanupError], "Initialization failed and cleanup also failed");
  }
}

/** Internal owner storage is accessible only to this package's context module. */
export function getOwnerProviders(owner: OwnerScope): Map<symbol, unknown> {
  return asScope(owner).providers;
}
