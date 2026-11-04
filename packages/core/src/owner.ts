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
  readonly providers = new Map<symbol, unknown>();
  componentInitialized = false;

  constructor(parent: Scope | null) {
    this.parent = parent;
    parent?.children.add(this);
  }

  get disposed(): boolean {
    return this.state === "disposed";
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

  initialize(): void {
    this.ensureAlive();
    if (this.state === "created") this.state = "initialized";
  }

  mount(): void {
    this.ensureAlive();
    if (this.state !== "created" && this.state !== "initialized") {
      throw new Error("Owner can only mount once");
    }
    this.state = "mounted";
    const callbacks = this.mountCallbacks.splice(0);
    try {
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

  dispose(): void {
    if (this.disposed) return;
    this.state = "disposed"; // Reject registrations before user cleanup runs.
    this.parent?.children.delete(this);
    const errors: unknown[] = [];
    const children = [...this.children].reverse();
    this.children.clear();
    for (const child of children) {
      try { child.dispose(); } catch (error) { errors.push(error); }
    }
    this.mountCallbacks.length = 0;
    // Cleanups may read providers owned by ancestors; clear only after descendants.
    for (let index = this.cleanups.length - 1; index >= 0; index--) {
      try { this.cleanups[index]?.(); } catch (error) { errors.push(error); }
    }
    this.cleanups.length = 0;
    this.providers.clear();
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

export function createOwner(parent: OwnerScope | null = null): OwnerScope {
  const parentScope = parent === null ? null : asScope(parent);
  parentScope?.ensureAlive();
  return new Scope(parentScope);
}

/** Lexical context is synchronous: it does not flow across await/Promise callbacks. */
export function runWithOwner<T>(owner: OwnerScope, initialize: () => T): T {
  const scope = asScope(owner);
  scope.ensureAlive();
  const previous = currentOwner;
  currentOwner = scope;
  try { return initialize(); } finally { currentOwner = previous; }
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
