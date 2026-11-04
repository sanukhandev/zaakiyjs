export type HttpErrorCode =
  | "HTTP_STATUS" | "NETWORK" | "TIMEOUT" | "CANCELLED" | "REQUEST_VALIDATION"
  | "RESPONSE_VALIDATION" | "PARSE" | "UNSUPPORTED" | "INVALID_CONFIG" | "DISPOSED";

export class HttpError extends Error {
  readonly name = "HttpError";
  constructor(
    readonly code: HttpErrorCode,
    message: string,
    readonly status?: number,
    options?: { cause?: unknown }
  ) {
    super(message, options);
  }
}
export function isHttpError(cause: unknown): cause is HttpError {
  return cause instanceof HttpError;
}
export function configError(message: string): HttpError {
  return new HttpError("INVALID_CONFIG", message);
}
/** No response contents, headers, cookies, token values or URLs appear in these messages. */
export function classifyFailure(cause: unknown): HttpError {
  if (cause instanceof HttpError) return cause;
  return new HttpError("NETWORK", "HTTP transport failed", undefined, { cause });
}
