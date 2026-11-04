import type { OwnerScope } from "@zaakiyjs/core";
import { signal } from "@zaakiyjs/signals";
import type { ReadonlySignal, WritableSignal } from "@zaakiyjs/signals";
import { awaitAbortable, abortedReason, composeSignals } from "./abort.js";
import type { Cancellation } from "./abort.js";
import { BusyError, CancellationError, ConfigurationError, DisposedError, classifyFailure, isCancellation } from "./errors.js";
import type { AsyncOperationError, CancellationKind } from "./errors.js";
import { ownerFor, attachOwner } from "./ownership.js";
import { runWithRetry, validateRetry } from "./retry.js";
import type { RetryOptions } from "./retry.js";

export type TaskPolicy = "latest" | "parallel" | "queue" | "reject";
export type TaskStatus = "idle" | "pending" | "success" | "error" | "cancelled";
export interface TaskContext<TInput> {
  readonly input: TInput;
  readonly signal: AbortSignal;
  readonly attempt: number;
}
export interface TaskRunOptions { readonly signal?: AbortSignal }
export interface TaskOptions<TInput, TResult> {
  readonly execute: (context: TaskContext<TInput>) => Promise<TResult>;
  readonly concurrency?: TaskPolicy;
  readonly maxQueue?: number;
  readonly owner?: OwnerScope | null;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
  readonly retry?: RetryOptions;
  /** Required to opt mutations into retry; server-side idempotency is caller's responsibility. */
  readonly idempotent?: boolean;
}
export interface Task<TResult, TInput> {
  readonly result: ReadonlySignal<TResult | undefined>;
  readonly lastSuccessful: ReadonlySignal<TResult | undefined>;
  readonly pending: ReadonlySignal<boolean>;
  /** Number of operations started but not yet settled (excluding queued work). */
  readonly pendingCount: ReadonlySignal<number>;
  readonly queuedCount: ReadonlySignal<number>;
  /** Status and result correspond to the latest invoked operation. */
  readonly status: ReadonlySignal<TaskStatus>;
  readonly error: ReadonlySignal<AsyncOperationError | null>;
  run(input: TInput, options?: TaskRunOptions): Promise<TResult>;
  cancel(): void;
  reset(): void;
  dispose(): void;
}
interface Queued<TInput, TResult> {
  readonly id: number;
  readonly input: TInput;
  readonly signal?: AbortSignal;
  readonly resolve: (value: TResult) => void;
  readonly reject: (error: unknown) => void;
  removeAbort?: () => void;
}
function readonly<T>(source: WritableSignal<T>): ReadonlySignal<T> {
  return { get value() { return source.value; }, peek: () => source.peek() };
}
export function createTask<TInput, TResult>(options: TaskOptions<TInput, TResult>): Task<TResult, TInput> {
  if (typeof options.execute !== "function") throw new ConfigurationError("execute must be a function");
  validateRetry(options.retry);
  if ((options.retry?.maxAttempts ?? 1) > 1 && options.idempotent !== true) {
    throw new ConfigurationError("Mutation retries require explicit idempotent: true");
  }
  if (options.timeoutMs !== undefined && (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0)) {
    throw new ConfigurationError("timeoutMs must be finite and positive");
  }
  const policy = options.concurrency ?? "latest";
  if (!["latest", "parallel", "queue", "reject"].includes(policy)) throw new ConfigurationError("Unknown concurrency policy");
  const maxQueue = options.maxQueue ?? 64;
  if (!Number.isSafeInteger(maxQueue) || maxQueue < 0 || maxQueue > 10_000) {
    throw new ConfigurationError("maxQueue must be an integer between 0 and 10000");
  }
  const owner = ownerFor(options.owner);
  const result = signal<TResult | undefined>(undefined);
  const lastSuccessful = signal<TResult | undefined>(undefined);
  const pending = signal(false);
  const pendingCount = signal(0);
  const queuedCount = signal(0);
  const status = signal<TaskStatus>("idle");
  const error = signal<AsyncOperationError | null>(null);
  const active = new Map<number, Cancellation>();
  const queue: Array<Queued<TInput, TResult>> = [];
  let closed = false;
  let sequence = 0;
  let newest = 0;

  function publishCounts(): void {
    if (closed) return;
    pendingCount.value = active.size;
    queuedCount.value = queue.length;
    pending.value = active.size > 0 || queue.length > 0;
  }
  function rejectQueue(reason: CancellationError): void {
    for (const item of queue.splice(0)) {
      item.removeAbort?.();
      item.reject(reason);
    }
    publishCounts();
  }
  function cancelAll(kind: CancellationKind): void {
    for (const context of active.values()) context.cancel(kind === "owner" ? "owner" : kind === "superseded" ? "superseded" : "manual");
    active.clear();
    rejectQueue(new CancellationError(kind));
    publishCounts();
  }
  async function start(id: number, input: TInput, provided?: AbortSignal): Promise<TResult> {
    // Both global and per-invocation caller signals are respected.
    const sources = [options.signal, provided].filter((s): s is AbortSignal => s !== undefined);
    const context = composeSignals(sources, options.timeoutMs);
    active.set(id, context);
    publishCounts();
    try {
      const value = await awaitAbortable(
        runWithRetry(attempt => options.execute({ input, signal: context.signal, attempt }), context.signal, options.retry),
        context.signal
      );
      if (context.signal.aborted) throw abortedReason(context.signal);
      if (!closed && id === newest) {
        result.value = value;
        lastSuccessful.value = value;
        error.value = null;
        status.value = "success";
      }
      return value;
    } catch (cause) {
      const failure = context.signal.aborted ? abortedReason(context.signal) : cause;
      if (!closed && id === newest) {
        if (isCancellation(failure)) {
          error.value = null;
          status.value = "cancelled";
        } else {
          error.value = classifyFailure(failure, "TASK_FAILED");
          status.value = "error";
        }
      }
      throw isCancellation(failure) ? failure : classifyFailure(failure, "TASK_FAILED");
    } finally {
      context.dispose();
      active.delete(id);
      publishCounts();
      if (!closed && policy === "queue") pump();
    }
  }
  function pump(): void {
    if (closed || active.size > 0 || queue.length === 0) return;
    const item = queue.shift()!;
    item.removeAbort?.();
    publishCounts();
    if (item.signal?.aborted) {
      item.reject(new CancellationError("caller", item.signal.reason));
      pump();
      return;
    }
    void start(item.id, item.input, item.signal).then(item.resolve, item.reject);
  }
  function run(input: TInput, runOptions: TaskRunOptions = {}): Promise<TResult> {
    if (closed || owner?.disposed) return Promise.reject(new DisposedError());
    if (policy === "reject" && active.size > 0) return Promise.reject(new BusyError());
    if (policy === "queue" && active.size > 0 && queue.length >= maxQueue) {
      return Promise.reject(new BusyError("QUEUE_FULL"));
    }
    const id = ++sequence;
    newest = id;
    error.value = null;
    status.value = "pending";
    if (policy === "latest") cancelAll("superseded");
    if (policy === "queue") {
      return new Promise<TResult>((resolve, reject) => {
        const item: Queued<TInput, TResult> = { id, input, signal: runOptions.signal, resolve, reject };
        const signal = runOptions.signal;
        if (signal) {
          const onAbort = (): void => {
            const index = queue.indexOf(item);
            if (index < 0) return; // Already started; active composition owns cancellation.
            queue.splice(index, 1);
            item.removeAbort?.();
            if (!closed && id === newest) {
              status.value = "cancelled";
              error.value = null;
            }
            publishCounts();
            reject(new CancellationError("caller", signal.reason));
          };
          signal.addEventListener("abort", onAbort, { once: true });
          item.removeAbort = () => signal.removeEventListener("abort", onAbort);
          if (signal.aborted) {
            item.removeAbort();
            reject(new CancellationError("caller", signal.reason));
            if (id === newest) status.value = "cancelled";
            return;
          }
        }
        queue.push(item);
        publishCounts();
        pump();
      });
    }
    return start(id, input, runOptions.signal);
  }
  function dispose(): void {
    if (closed) return;
    closed = true;
    cancelAll("owner");
    // Do not publish state after disposal.
  }
  const task: Task<TResult, TInput> = {
    result: readonly(result),
    lastSuccessful: readonly(lastSuccessful),
    pending: readonly(pending), pendingCount: readonly(pendingCount),
    queuedCount: readonly(queuedCount), status: readonly(status), error: readonly(error),
    run,
    cancel() {
      if (closed) throw new DisposedError();
      cancelAll("manual");
      status.value = "cancelled";
      error.value = null;
    },
    reset() {
      if (closed) throw new DisposedError();
      newest = ++sequence;
      cancelAll("manual");
      result.value = undefined;
      error.value = null;
      status.value = "idle";
    },
    dispose
  };
  attachOwner(owner, dispose);
  return task;
}
