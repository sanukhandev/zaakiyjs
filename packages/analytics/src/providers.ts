import type { AnalyticsProviderV1, AnalyticsRecordV1 } from './types.js';

export interface MemoryProvider extends AnalyticsProviderV1 {
  readonly events: readonly AnalyticsRecordV1[];
  clear(): void;
}
/** No network and no default persistent storage. */
export function createMemoryProvider(): MemoryProvider {
  const events: AnalyticsRecordV1[] = [];
  return {
    version: 1,
    get events() { return events; },
    async start() {},
    async send(batch) { events.push(...batch); },
    async flush() {},
    async dispose() {},
    clear() { events.length = 0; }
  };
}
export interface HttpProviderOptions {
  readonly endpoint: string;
  readonly fetcher?: typeof fetch;
  readonly headers?: Readonly<Record<string, string>>;
  readonly allowedOrigins?: readonly string[];
}
/** Explicit generic JSON adapter, never instantiated by the analytics entrypoint. */
export function createHttpProvider(options: HttpProviderOptions): AnalyticsProviderV1 {
  if (!options || typeof options.endpoint !== 'string') throw new TypeError('Endpoint required');
  const endpoint = options.endpoint;
  if (!endpoint.startsWith('/') && !/^https:\/\//.test(endpoint)) throw new TypeError('Analytics endpoint must be relative or HTTPS');
  if (endpoint.startsWith('//') || endpoint.includes('\\') || /[?#@]/.test(endpoint) || /[\x00-\x1f\x7f]/.test(endpoint)) throw new TypeError('Unsafe analytics endpoint');
  if (endpoint.startsWith('https://')) {
    const url = new URL(endpoint);
    if (url.username || url.password || url.search || url.hash) throw new TypeError('Credentials and queries are forbidden');
    if (!options.allowedOrigins?.includes(url.origin)) throw new TypeError('HTTPS analytics endpoint origin must be explicitly allowed');
  }
  const headers = { 'content-type': 'application/json', ...options.headers };
  for (const [key, value] of Object.entries(headers)) {
    if (!/^[\w-]+$/.test(key) || /[\r\n]/.test(value) || /^(?:authorization|cookie|proxy-authorization|.*(?:api.?key|secret|token|credential).*)$/i.test(key)) {
      throw new TypeError('Unsafe browser analytics header');
    }
  }
  return {
    version: 1,
    async start() {},
    async send(events, signal) {
      const transport = options.fetcher ?? (typeof fetch === 'function' ? fetch : undefined);
      if (!transport) throw new Error('fetch is unavailable');
      const response = await transport(endpoint, {
        method: 'POST', credentials: 'omit', redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer',
        headers, body: JSON.stringify({ events }), signal
      });
      if (!response.ok) throw new Error('HTTP ' + response.status);
    },
    async flush() {},
    async dispose() {}
  };
}
