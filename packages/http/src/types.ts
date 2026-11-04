export type HttpMethod = "GET" | "HEAD" | "POST" | "PUT" | "PATCH" | "DELETE" | "OPTIONS";
export type ResponseType = "auto" | "json" | "text" | "blob" | "arrayBuffer" | "stream";
export type QueryValue = string | number | boolean | null | undefined | readonly (string | number | boolean | null | undefined)[];
export type QueryParams = Record<string, QueryValue>;

export interface Validator<T> {
  parse(value: unknown): T | Promise<T>;
}
export interface RetryPolicy {
  /** Total attempts, including the first request. Defaults to 1 (no retry). */
  readonly maxAttempts?: number;
  readonly baseDelayMs?: number;
  readonly maxDelayMs?: number;
  readonly maxElapsedMs?: number;
  readonly jitter?: boolean;
  readonly statusCodes?: readonly number[];
  readonly retryNetworkErrors?: boolean;
  /** Must also supply a server-enforced idempotency key for unsafe HTTP methods. */
  readonly allowUnsafeMethods?: boolean;
}
export interface AuthAdapter {
  getToken(context: { readonly signal: AbortSignal }): string | undefined | Promise<string | undefined>;
  /** Optional; invoked on one 401 only when the method is safe or has an idempotency key. */
  refreshToken?(context: { readonly signal: AbortSignal }): Promise<string | undefined>;
}
export interface ClientOptions {
  readonly baseURL: string;
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
  readonly credentials?: RequestCredentials;
  /** Additional origins; off-origin requests never receive automatic credentials/auth headers. */
  readonly allowedOrigins?: readonly string[];
  readonly auth?: AuthAdapter;
  readonly retry?: RetryPolicy;
  readonly maxResponseBytes?: number;
}
export interface RequestOptions<TResponse = unknown, TBody = unknown, TQuery extends QueryParams = QueryParams> {
  readonly method: HttpMethod;
  readonly url: string;
  readonly query?: TQuery;
  readonly headers?: HeadersInit;
  readonly body?: TBody;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
  readonly credentials?: RequestCredentials;
  readonly responseType?: ResponseType;
  readonly responseSchema?: Validator<TResponse>;
  readonly requestSchema?: Validator<TBody>;
  readonly retry?: RetryPolicy | false;
  readonly maxResponseBytes?: number;
  /** Required in conjunction with retry.allowUnsafeMethods for unsafe mutations. */
  readonly idempotencyKey?: string;
  /** Default error; manual can inspect redirects, but follow is intentionally prohibited. */
  readonly redirect?: "error" | "manual";
  /** Disable client bearer-token injection for this request. */
  readonly auth?: boolean;
}
export interface HttpRequestContext {
  method: HttpMethod;
  url: URL;
  headers: Headers;
  body: BodyInit | null;
  credentials: RequestCredentials;
  redirect: "error" | "manual";
  readonly signal: AbortSignal;
}
export interface HttpResponse<T> {
  readonly data: T;
  readonly status: number;
  readonly headers: Headers;
  readonly url: string;
}
export interface HttpRecovery {
  readonly recovered: true;
  readonly value: HttpResponse<unknown>;
}
export type RequestInterceptor = (context: HttpRequestContext) =>
  void | HttpRequestContext | Response | Promise<void | HttpRequestContext | Response>;
export type ResponseInterceptor = (response: HttpResponse<unknown>) =>
  HttpResponse<unknown> | Promise<HttpResponse<unknown>>;
export type ErrorInterceptor = (error: import("./errors.js").HttpError) =>
  void | HttpRecovery | Promise<void | HttpRecovery>;
export interface InterceptorList<T> {
  use(handler: T): () => void;
  clear(): void;
}
export interface HttpInterceptors {
  readonly request: InterceptorList<RequestInterceptor>;
  readonly response: InterceptorList<ResponseInterceptor>;
  readonly error: InterceptorList<ErrorInterceptor>;
}
export type Options<T, B, Q extends QueryParams> = Omit<RequestOptions<T, B, Q>, "url" | "method" | "body">;
export interface HttpClient {
  readonly interceptors: HttpInterceptors;
  request<T = unknown, B = unknown, Q extends QueryParams = QueryParams>(options: RequestOptions<T, B, Q>): Promise<T>;
  requestDetailed<T = unknown, B = unknown, Q extends QueryParams = QueryParams>(options: RequestOptions<T, B, Q>): Promise<HttpResponse<T>>;
  get<T = unknown, Q extends QueryParams = QueryParams>(url: string, options?: Options<T, never, Q>): Promise<T>;
  delete<T = unknown, Q extends QueryParams = QueryParams>(url: string, options?: Options<T, never, Q>): Promise<T>;
  post<T = unknown, B = unknown, Q extends QueryParams = QueryParams>(url: string, body?: B, options?: Options<T, B, Q>): Promise<T>;
  put<T = unknown, B = unknown, Q extends QueryParams = QueryParams>(url: string, body?: B, options?: Options<T, B, Q>): Promise<T>;
  patch<T = unknown, B = unknown, Q extends QueryParams = QueryParams>(url: string, body?: B, options?: Options<T, B, Q>): Promise<T>;
  /** Permanently disposes this client and cancels outstanding logical requests. */
  dispose(): void;
}
