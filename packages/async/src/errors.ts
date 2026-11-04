export type CancellationKind = "manual" | "owner" | "superseded" | "timeout" | "caller";
export type AsyncErrorCode = "RESOURCE_FAILED" | "TASK_FAILED" | "CANCELLED" | "TIMEOUT" | "BUSY" | "QUEUE_FULL" | "INVALID_CONFIG" | "DISPOSED";
export class AsyncOperationError extends Error {
  constructor(message: string, public readonly code: AsyncErrorCode, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "AsyncOperationError";
  }
}
export class CancellationError extends AsyncOperationError {
  constructor(public readonly kind: CancellationKind, cause?: unknown) {
    super("Async operation cancelled (" + kind + ")", kind === "timeout" ? "TIMEOUT" : "CANCELLED", { cause });
    this.name = "CancellationError";
  }
}
export class TimeoutError extends CancellationError {
  constructor(cause?: unknown) {
    super("timeout", cause);
    this.name = "TimeoutError";
  }
}
export class BusyError extends AsyncOperationError {
  constructor(code: "BUSY" | "QUEUE_FULL" = "BUSY") {
    super(code === "BUSY" ? "Async task already running" : "Async task queue is full", code);
    this.name = "BusyError";
  }
}
export class ConfigurationError extends AsyncOperationError {
  constructor(message: string) { super(message, "INVALID_CONFIG"); this.name = "ConfigurationError"; }
}
export class DisposedError extends AsyncOperationError {
  constructor() { super("Async handle has been disposed", "DISPOSED"); this.name = "DisposedError"; }
}
export function isCancellation(error: unknown): error is CancellationError {
  return error instanceof CancellationError;
}
export function classifyFailure(error: unknown, type: "RESOURCE_FAILED" | "TASK_FAILED"): AsyncOperationError {
  return error instanceof AsyncOperationError ? error : new AsyncOperationError(
    type === "RESOURCE_FAILED" ? "Resource loading failed" : "Task execution failed", type, { cause: error }
  );
}
