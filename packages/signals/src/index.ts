/** Fine-grained, DOM-independent reactive primitives. */
export const foundationStatus = { package: "@zaakiyjs/signals", implemented: true } as const;

export interface ReadonlySignal<T> {
  readonly value: T;
  peek(): T;
}
export interface WritableSignal<T> extends ReadonlySignal<T> { value: T }
export type Equality<T> = (previous: T, next: T) => boolean;
export interface EffectHandle { dispose(): void }
export type EffectPhase = "render" | "user";
export interface EffectOptions {
  readonly phase?: EffectPhase;
  readonly onError?: (error: unknown) => void;
}
export type ComputedSignal<T> = ReadonlySignal<T>;
export type Untracked<T> = () => T;

type Observer = EffectNode | ComputedNode<unknown>;
type Source = SignalNode<unknown> | ComputedNode<unknown>;

interface TrackingFrame {
  readonly observer: Observer;
  readonly seen: Set<Source>;
}

let activeFrame: TrackingFrame | null = null;
let computedDepth = 0;
let batchDepth = 0;
let microtaskQueued = false;
let flushing = false;
const renderQueue = new Set<EffectNode>();
const userQueue = new Set<EffectNode>();
const MAX_EXECUTIONS_PER_FLUSH = 1_000_000;
const MAX_RUNS_PER_EFFECT_PER_FLUSH = 1_000;
let flushSequence = 0;

function reportUnobservedError(error: unknown): void { throw error; }

function enqueue(effectNode: EffectNode): void {
  if (effectNode.disposed) return;
  (effectNode.phase === "render" ? renderQueue : userQueue).add(effectNode);
  if (batchDepth === 0 && !flushing) requestFlush();
}

function requestFlush(): void {
  if (microtaskQueued || (!renderQueue.size && !userQueue.size)) return;
  microtaskQueued = true;
  queueMicrotask(() => {
    microtaskQueued = false;
    if (batchDepth === 0 && !flushing) drain();
  });
}

function drain(): void {
  if (flushing) return;
  flushing = true;
  const errors: unknown[] = [];
  const flushId = ++flushSequence;
  let executions = 0;
  try {
    while (renderQueue.size || userQueue.size) {
      const queue = renderQueue.size ? renderQueue : userQueue;
      const next = queue.values().next().value;
      if (next === undefined) break;
      queue.delete(next);
      if (next.disposed) continue;
      if (++executions > MAX_EXECUTIONS_PER_FLUSH) {
        errors.push(new Error("ZaakiyJS reactive cycle: exceeded " + MAX_EXECUTIONS_PER_FLUSH + " effect executions in one flush"));
        break;
      }
      if (next.lastFlushId === flushId) {
        if (++next.runsThisFlush > MAX_RUNS_PER_EFFECT_PER_FLUSH) {
          errors.push(new Error("ZaakiyJS reactive cycle: effect ran over " + MAX_RUNS_PER_EFFECT_PER_FLUSH + " times in one flush"));
          break;
        }
      } else {
        next.lastFlushId = flushId;
        next.runsThisFlush = 1;
      }
      try { next.execute(); }
      catch (error) { errors.push(error); }
    }
  } finally {
    if (errors.length && (renderQueue.size || userQueue.size)) {
      renderQueue.clear();
      userQueue.clear();
    }
    flushing = false;
  }
  if (errors.length === 1) reportUnobservedError(errors[0]);
  if (errors.length > 1) throw new AggregateError(errors, "Multiple reactive effect failures");
}

function observe(source: Source): void {
  const frame = activeFrame;
  if (frame === null || (frame.observer instanceof EffectNode && frame.observer.disposed)) return;
  const { observer, seen } = frame;
  if (source === observer) throw new Error("ZaakiyJS circular computed dependency");
  if (seen.has(source)) return;
  seen.add(source);
  // Cold computed dependencies are relinked when the first observer attaches.
  if (!observer.dependencies.has(source) && !(observer instanceof ComputedNode && observer.observers.size === 0)) {
    source.addObserver(observer);
  }
}

function runTracked<T>(observer: Observer, evaluate: () => T): T {
  const before = observer.dependencies;
  const seen = new Set<Source>();
  const previous = activeFrame;
  activeFrame = { observer, seen };
  let succeeded = false;
  try {
    const result = evaluate();
    succeeded = true;
    return result;
  } finally {
    activeFrame = previous;
    if (observer instanceof EffectNode && observer.disposed) {
      // An effect may dispose itself during execution. Never resurrect subscriptions.
      for (const source of before) source.removeObserver(observer);
      for (const source of seen) source.removeObserver(observer);
      observer.dependencies = new Set();
    } else if (succeeded) {
      for (const source of before) if (!seen.has(source)) source.removeObserver(observer);
      observer.dependencies = seen;
      if (observer instanceof ComputedNode) {
        observer.revisions = new Map([...seen].map((source) => [source, source.revision()]));
      }
    } else {
      // On failure keep known and partial dependencies for possible recovery.
      for (const source of seen) before.add(source);
    }
  }
}

class SignalNode<T> implements WritableSignal<T> {
  private current: T;
  private version = 0;
  readonly observers = new Set<Observer>();
  constructor(initial: T, private readonly equals: Equality<T>) { this.current = initial; }
  get value(): T { observe(this as SignalNode<unknown>); return this.current; }
  set value(next: T) {
    if (computedDepth > 0) {
      throw new Error("ZaakiyJS computed calculators must not write signals");
    }
    if (this.equals(this.current, next)) return;
    this.current = next;
    this.version++;
    for (const observer of [...this.observers]) observer.invalidate();
  }
  peek(): T { return this.current; }
  revision(): number { return this.version; }
  addObserver(observer: Observer): void { this.observers.add(observer); }
  removeObserver(observer: Observer): void { this.observers.delete(observer); }
}

class ComputedNode<T> implements ComputedSignal<T> {
  readonly observers = new Set<Observer>();
  dependencies = new Set<Source>();
  revisions = new Map<Source, number>();
  private cached!: T;
  private hasValue = false;
  private dirty = true;
  private errored = false;
  private computing = false;
  private version = 0;
  constructor(private readonly calculator: () => T) {}

  get value(): T {
    if (this.computing) throw new Error("ZaakiyJS circular computed dependency");
    observe(this as ComputedNode<unknown>);
    return this.read();
  }
  peek(): T { return this.read(); }
  private read(): T {
    this.checkStaleness();
    if (this.dirty) {
      if (this.computing) throw new Error("ZaakiyJS circular computed dependency");
      this.computing = true;
      computedDepth++;
      try {
        const result = runTracked(this as ComputedNode<unknown>, this.calculator);
        this.cached = result;
        this.hasValue = true;
        this.dirty = false;
        this.errored = false;
      } catch (error) {
        this.errored = true;
        throw error;
      } finally { computedDepth--; this.computing = false; }
    }
    return this.cached;
  }
  private checkStaleness(): void {
    if (this.dirty || !this.hasValue) return;
    for (const [source, lastVersion] of this.revisions) {
      if (source.revision() !== lastVersion) {
        this.invalidate();
        break;
      }
    }
  }
  revision(): number {
    if (this.computing) throw new Error("ZaakiyJS circular computed dependency");
    this.checkStaleness();
    return this.version;
  }
  invalidate(): void {
    // A failed calculator remains dirty; future source writes must still wake consumers.
    if (this.dirty && !this.errored) return;
    this.dirty = true;
    this.version++;
    for (const observer of [...this.observers]) observer.invalidate();
  }
  addObserver(observer: Observer): void {
    if (this.observers.has(observer)) return;
    if (this.observers.size === 0) {
      this.checkStaleness();
      // Reconnect known dependencies even if dirty. The next read prunes stale
      // sources; already-known sources must be subscribed when observed.
      for (const source of this.dependencies) source.addObserver(this as ComputedNode<unknown>);
    }
    this.observers.add(observer);
  }
  removeObserver(observer: Observer): void {
    this.observers.delete(observer);
    if (this.observers.size === 0) {
      for (const source of this.dependencies) source.removeObserver(this as ComputedNode<unknown>);
    }
  }
}

class EffectNode implements EffectHandle {
  dependencies = new Set<Source>();
  disposed = false;
  lastFlushId = 0;
  runsThisFlush = 0;
  private running = false;
  private cleanup: (() => void) | undefined;
  readonly phase: EffectPhase;
  constructor(private readonly run: () => void | (() => void), private readonly onError?: (error: unknown) => void, phase: EffectPhase = "user") {
    this.phase = phase;
  }
  invalidate(): void { enqueue(this); }
  execute(): void {
    if (this.disposed) return;
    if (this.running) throw new Error("ZaakiyJS effect cannot execute recursively");
    this.running = true;
    const oldCleanup = this.cleanup;
    this.cleanup = undefined;
    try {
      oldCleanup?.();
      if (this.disposed) return; // Cleanup can dispose its effect before the next body.
      const result = runTracked(this, this.run);
      if (typeof result === "function") {
        if (this.disposed) result(); // Run a cleanup returned after self-disposal.
        else this.cleanup = result;
      }
    } catch (error) {
      if (this.onError) this.onError(error);
      else throw error;
    } finally { this.running = false; }
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    renderQueue.delete(this);
    userQueue.delete(this);
    for (const source of this.dependencies) source.removeObserver(this);
    this.dependencies.clear();
    const cleanup = this.cleanup;
    this.cleanup = undefined;
    cleanup?.();
  }
}

/** Create mutable reactive state; custom equality must be pure. */
export function signal<T>(initial: T, options?: { readonly equals?: Equality<T> }): WritableSignal<T> {
  return new SignalNode(initial, options?.equals ?? Object.is);
}
/** A lazy, cached, dynamically tracked, readonly derivation. */
export function computed<T>(read: () => T): ComputedSignal<T> {
  return new ComputedNode(read);
}
/** Run immediately, then rerun in the configured phase when tracked inputs change. */
export function effect(run: () => void | (() => void), options: EffectOptions = {}): EffectHandle {
  const node = new EffectNode(run, options.onError, options.phase ?? "user");
  try { node.execute(); }
  catch (error) { node.dispose(); throw error; }
  return node;
}
/** Delay automatic effect flushing until the outermost batch completes. */
export function batch<T>(run: () => T): T {
  batchDepth++;
  try { return run(); }
  finally { if (--batchDepth === 0) requestFlush(); }
}
/** Suppress dependency tracking in this synchronous callback. */
export function untrack<T>(read: () => T): T {
  const previous = activeFrame;
  activeFrame = null;
  try { return read(); }
  finally { activeFrame = previous; }
}
/** Run optional work and synchronously drain effects (render before user). */
export function flushSync(): void;
export function flushSync<T>(run: () => T): T;
export function flushSync<T>(run?: () => T): T | void {
  if (activeFrame) throw new Error("ZaakiyJS flushSync cannot run inside a tracked computation");
  if (flushing) throw new Error("ZaakiyJS flushSync cannot reenter an active scheduler flush");
  let value: T | undefined;
  let failed = false;
  let callbackError: unknown;
  try { value = run?.(); }
  catch (error) { failed = true; callbackError = error; }
  try { drain(); }
  catch (error) {
    if (failed) throw new AggregateError([callbackError, error], "flushSync callback and effect both failed");
    throw error;
  }
  if (failed) throw callbackError;
  return value;
}
