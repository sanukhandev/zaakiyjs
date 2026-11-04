import { lookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import type { ClientRequest, IncomingHttpHeaders, IncomingMessage } from "node:http";
import type { RequestOptions } from "node:https";
import { allowedAddress, ProxyPayloadError, ProxyPolicyError, ProxyTimeoutError, ProxyUpstreamError, responseHeaders } from "./security.js";
import type { AddressResolver, ProxyBody, ProxyOutgoing, ProxyUpstream } from "./types.js";

export const defaultResolver: AddressResolver = async (hostname, signal) => {
  if (signal.aborted) throw signal.reason;
  const addresses = await lookup(hostname, { all: true, verbatim: true });
  if (signal.aborted) throw signal.reason;
  return addresses.map(({ address, family }) => ({ address, family: family as 4 | 6 }));
};

function firstValidatedAddress(addresses: readonly { address: string; family: number }[], upstream: ProxyUpstream): { address: string; family: 4 | 6 } {
  if (!addresses.length || addresses.some(entry => !allowedAddress(entry.address, upstream) || isIP(entry.address) !== entry.family)) {
    throw new ProxyPolicyError("Unapproved upstream network destination");
  }
  const chosen = addresses[0]!;
  return { address: chosen.address, family: chosen.family as 4 | 6 };
}
function abortRace<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const abort = (): void => { cleanup(); reject(signal.reason); };
    const cleanup = (): void => signal.removeEventListener("abort", abort);
    signal.addEventListener("abort", abort, { once: true });
    operation.then(value => { cleanup(); resolve(value); }, reason => { cleanup(); reject(reason); });
    if (signal.aborted) abort();
  });
}
export interface TransportInput {
  readonly origin: URL;
  readonly upstream: ProxyUpstream;
  readonly path: string;
  readonly method: string;
  readonly requestHeaders: Readonly<Record<string, string>>;
  readonly responseHeaderAllowlist?: readonly string[];
  readonly body?: ProxyBody;
  readonly maxRequestBytes: number;
  readonly signal: AbortSignal;
  readonly resolver: AddressResolver;
}
export async function dispatch(input: TransportInput): Promise<ProxyOutgoing> {
  const hostname = input.origin.hostname.replace(/^\[|\]$/g, "");
  const ipFamily = isIP(hostname);
  const addresses = ipFamily ? [{ address: hostname, family: ipFamily as 4 | 6 }] : await abortRace(input.resolver(hostname, input.signal), input.signal);
  const pinned = firstValidatedAddress(addresses, input.upstream);
  if (input.signal.aborted) throw input.signal.reason;
  const options: RequestOptions = {
    hostname,
    port: input.origin.port || (input.origin.protocol === "https:" ? 443 : 80),
    method: input.method,
    path: input.path,
    // Node auto-frames streamed POST/PUT/PATCH bodies, but not DELETE/OPTIONS.
    // Incoming framing headers are stripped; explicitly frame every streamed
    // request, including DELETE and OPTIONS, with generated chunked encoding.
    headers: input.body ? { ...input.requestHeaders, "transfer-encoding": "chunked" } : input.requestHeaders,
    agent: false,
    // The TLS hostname stays approved while lookup returns only the validated IP.
    lookup: (_hostname, lookupOptions, callback) => {
      if (lookupOptions.all) callback(null, [{ address: pinned.address, family: pinned.family }]);
      else callback(null, pinned.address, pinned.family);
    },
    rejectUnauthorized: true
  };
  const request = input.origin.protocol === "https:" ? httpsRequest : httpRequest;
  return new Promise<ProxyOutgoing>((resolve, reject) => {
    let settled = false;
    let cleanupTimer: ReturnType<typeof setTimeout> | undefined;
    let upstreamRequest!: ClientRequest;
    let upstreamResponse: IncomingMessage | undefined;
    let consumed = false;
    let writerDone = false;
    const cleanup = (): void => {
      if (cleanupTimer !== undefined) { clearTimeout(cleanupTimer); cleanupTimer = undefined; }
      input.signal.removeEventListener("abort", onAbort);
    };
    const fail = (reason: unknown): void => {
      cleanup();
      if (!settled) { settled = true; reject(reason); }
    };
    const onAbort = (): void => {
      upstreamRequest.destroy(input.signal.reason instanceof Error ? input.signal.reason : new Error("Request cancelled"));
      fail(input.signal.reason);
    };
    const cancel = (): void => {
      cleanup(); upstreamResponse?.destroy(); upstreamRequest.destroy();
    };
    const deliver = (response: IncomingMessage): void => {
      if (settled) return;
      settled = true;
      if (cleanupTimer !== undefined) { clearTimeout(cleanupTimer); cleanupTimer = undefined; }
      const maximum = input.upstream.maxResponseBytes ?? 8_388_608;
      const body = async function* (): AsyncGenerator<Uint8Array> {
        if (consumed) throw new ProxyUpstreamError("Response already consumed");
        consumed = true;
        let size = 0;
        try {
          for await (const chunk of response) {
            if (input.signal.aborted) throw input.signal.reason;
            const buffer = chunk as Buffer;
            size += buffer.byteLength;
            if (size > maximum) throw new ProxyUpstreamError("Upstream response size exceeded");
            yield buffer;
          }
        } finally { cancel(); }
      };
      const headers = responseHeaders(response.headers as IncomingHttpHeaders, input.responseHeaderAllowlist);
      resolve({ status: response.statusCode ?? 502, headers, body: input.method === "HEAD" ? undefined : body(), cancel });
      if (input.method === "HEAD") cancel();
    };
    try {
      upstreamRequest = request(options, response => {
        if (settled) { response.destroy(); return; }
        if ((response.statusCode ?? 502) >= 300 && (response.statusCode ?? 502) < 400 && response.headers.location) {
          response.destroy(); fail(new ProxyPolicyError("Upstream redirect refused")); return;
        }
        const declaredLength = response.headers["content-length"];
        if (declaredLength && /^\d+$/.test(declaredLength) && Number(declaredLength) > (input.upstream.maxResponseBytes ?? 8_388_608)) {
          response.destroy(); fail(new ProxyUpstreamError("Response size limit exceeded")); return;
        }
        upstreamResponse = response;
        // A server may reply before consuming a streamed request. Do not emit a
        // successful downstream status until the entire inbound body passed limits.
        response.pause();
        if (writerDone) deliver(response);
      });
    } catch (error) { fail(error); return; }
    upstreamRequest.on("error", error => {
      if (!settled) fail(input.signal.aborted ? input.signal.reason : new ProxyUpstreamError(error.message));
    });
    upstreamRequest.on("socket", socket => {
      const connected = (): void => { if (cleanupTimer !== undefined) { clearTimeout(cleanupTimer); cleanupTimer = undefined; } };
      socket.once(input.origin.protocol === "https:" ? "secureConnect" : "connect", connected);
      cleanupTimer = setTimeout(() => {
        upstreamRequest.destroy(new ProxyTimeoutError());
        fail(new ProxyTimeoutError());
      }, input.upstream.connectTimeoutMs ?? 5_000);
    });
    input.signal.addEventListener("abort", onAbort, { once: true });
    if (input.signal.aborted) { onAbort(); return; }
    // Request-body streaming preserves backpressure and enforces a hard byte limit.
    void (async () => {
      try {
        if (input.body) {
          let count = 0;
          for await (const chunk of input.body) {
            if (input.signal.aborted) throw input.signal.reason;
            count += chunk.byteLength;
            if (count > input.maxRequestBytes) throw new ProxyPayloadError();
            if (!upstreamRequest.write(chunk)) await new Promise<void>((done, reject) => {
              const release = (): void => { upstreamRequest.off("drain", drained); upstreamRequest.off("error", failed); input.signal.removeEventListener("abort", aborted); };
              const drained = (): void => { release(); done(); };
              const failed = (err: Error): void => { release(); reject(err); };
              const aborted = (): void => { release(); reject(input.signal.reason); };
              upstreamRequest.once("drain", drained);
              upstreamRequest.once("error", failed);
              input.signal.addEventListener("abort", aborted, { once: true });
              if (input.signal.aborted) aborted();
            });
          }
        }
        if (!upstreamRequest.destroyed) upstreamRequest.end();
        writerDone = true;
        if (upstreamResponse) deliver(upstreamResponse);
      } catch (error) {
        upstreamRequest.destroy(); fail(error);
      }
    })();
  });
}
