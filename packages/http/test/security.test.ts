import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { createHttpClient } from "../src/index.js";

const baseURL = "https://api.example.test/api/";
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("HTTP security and lifecycle regressions", () => {
  it("orders terminal error interceptors, recovers explicitly, then runs response transforms", async () => {
    const sequence: string[] = [];
    const client = createHttpClient({ baseURL, fetch: async () => new Response("internal", { status: 503 }) });
    const remove = client.interceptors.error.use(error => {
      sequence.push("error-one:" + error.code);
    });
    client.interceptors.error.use(error => {
      sequence.push("error-two:" + error.status);
      return { recovered: true, value: { data: { fallback: true }, status: 200, headers: new Headers(), url: "cache" } };
    });
    client.interceptors.response.use(data => { sequence.push("response"); return data; });
    expect(await client.get("/unstable")).toEqual({ fallback: true });
    expect(sequence).toEqual(["error-one:HTTP_STATUS", "error-two:503", "response"]);
    remove();
    sequence.length = 0;
    await client.get("/unstable");
    expect(sequence).toEqual(["error-two:503", "response"]);
    client.dispose();
  });

  it("never recovers parse errors using an HTTP error interceptor", async () => {
    const recover = vi.fn(() => ({
      recovered: true as const,
      value: { data: "unsafe", status: 200, url: "", headers: new Headers() }
    }));
    const client = createHttpClient({
      baseURL, fetch: async () => new Response("not-json", { headers: { "content-type": "application/json" } })
    });
    client.interceptors.error.use(recover);
    await expect(client.get("/parse")).rejects.toMatchObject({ code: "PARSE" });
    expect(recover).toHaveBeenCalledOnce();
    client.dispose();
  });

  it("fails closed on 401/403 even when an error interceptor proposes recovery", async () => {
    for (const status of [401, 403]) {
      const client = createHttpClient({ baseURL, fetch: async () => new Response(null, { status }) });
      client.interceptors.error.use(() => ({
        recovered: true, value: { data: { authorized: true }, status: 200, headers: new Headers(), url: baseURL }
      }));
      await expect(client.get("/protected")).rejects.toMatchObject({ code: "HTTP_STATUS", status });
      client.dispose();
    }
  });

  it("classifies token refresh expiration as TIMEOUT even when request timeout is longer", async () => {
    vi.useFakeTimers();
    const client = createHttpClient({
      baseURL, timeoutMs: 20,
      auth: { getToken: () => "expired", refreshToken: () => new Promise<string>(() => {}) },
      fetch: async () => new Response(null, { status: 401 })
    });
    const pending = client.get("/refresh", { timeoutMs: 500 });
    const result = expect(pending).rejects.toMatchObject({ code: "TIMEOUT" });
    await vi.advanceTimersByTimeAsync(20);
    await result;
    client.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("propagates interceptor exceptions rather than swallowing them", async () => {
    const client = createHttpClient({ baseURL, fetch: async () => new Response(null, { status: 500 }) });
    client.interceptors.error.use(() => { throw new Error("diagnostic-hook-failed"); });
    await expect(client.get("/failure")).rejects.toThrow("diagnostic-hook-failed");
    client.dispose();
  });

  it("runs request schema validation before transport and rejects invalid payloads", async () => {
    const seen: unknown[] = [];
    const client = createHttpClient({ baseURL, fetch: async (_url, init) => {
      seen.push(JSON.parse(String(init?.body)) as unknown);
      return new Response(null, { status: 204 });
    } });
    await client.post("/valid", { name: "Ada" }, {
      requestSchema: {
        parse(value) {
          if (!value.name) throw Error("name required");
          return { name: value.name.trim() };
        }
      }
    });
    expect(seen).toEqual([{ name: "Ada" }]);
    await expect(client.post("/invalid", { name: "" }, {
      requestSchema: {
        parse(value) {
          if (!value.name) throw Error("name required");
          return value;
        }
      }
    })).rejects.toMatchObject({ code: "REQUEST_VALIDATION" });
    expect(seen).toHaveLength(1);
    client.dispose();
  });

  it("rejects pre-aborted signals before invoking a transport or interceptor", async () => {
    const fetch = vi.fn(async () => new Response("ok"));
    const intercept = vi.fn(() => {});
    const client = createHttpClient({ baseURL, fetch });
    client.interceptors.request.use(intercept);
    const controller = new AbortController();
    controller.abort("no-request");
    await expect(client.get("/never", { signal: controller.signal })).rejects.toMatchObject({
      code: "CANCELLED", cause: "no-request"
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(intercept).not.toHaveBeenCalled();
    client.dispose();
  });

  it("aborts while reading an uncooperative streaming body and clears timeout", async () => {
    vi.useFakeTimers();
    const client = createHttpClient({ baseURL, fetch: async () => new Response(new ReadableStream<Uint8Array>({
      start() { /* stream intentionally never closes */ }
    }), { headers: { "content-type": "text/plain" } }) });
    const pending = client.get("/never-finishes", { timeoutMs: 50 });
    const rejected = expect(pending).rejects.toMatchObject({ code: "TIMEOUT" });
    await vi.advanceTimersByTimeAsync(50);
    await rejected;
    client.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("retries a protected mutation with a key but invokes request interceptors only once", async () => {
    let attempts = 0;
    let interceptCalls = 0;
    const client = createHttpClient({ baseURL, fetch: async (_url, init) => {
      attempts++;
      expect(new Headers(init?.headers).get("idempotency-key")).toBe("save-record-1");
      return attempts === 1 ? new Response(null, { status: 503 }) :
        new Response('{"saved":true}', { headers: { "content-type": "application/json" } });
    } });
    client.interceptors.request.use(() => { interceptCalls++; });
    const result = await client.post("/save", { id: 1 }, {
      idempotencyKey: "save-record-1",
      retry: { maxAttempts: 2, baseDelayMs: 0, maxDelayMs: 0, allowUnsafeMethods: true }
    });
    expect(result).toEqual({ saved: true });
    expect(attempts).toBe(2);
    expect(interceptCalls).toBe(1);
    client.dispose();
  });

  it("refuses mutation replay if an interceptor strips or changes its idempotency key", async () => {
    for (const action of ["delete", "replace"] as const) {
      const transport = vi.fn(async () => new Response(null, { status: 503 }));
      const client = createHttpClient({ baseURL, fetch: transport });
      client.interceptors.request.use(ctx => {
        if (action === "delete") ctx.headers.delete("idempotency-key");
        else ctx.headers.set("idempotency-key", "different");
      });
      await expect(client.post("/save", { id: 1 }, {
        idempotencyKey: "original",
        retry: { maxAttempts: 2, allowUnsafeMethods: true }
      })).rejects.toMatchObject({ code: "INVALID_CONFIG" });
      expect(transport).not.toHaveBeenCalled();
      client.dispose();
    }
  });

  it("validates the final response exactly once, allowing schema transforms", async () => {
    const parse = vi.fn((value: unknown): number => {
      if (typeof value !== "string") throw new Error("Expected string");
      return Number(value);
    });
    const client = createHttpClient({ baseURL, fetch: async () =>
      new Response("42", { headers: { "content-type": "text/plain" } })
    });
    client.interceptors.response.use(value => ({ ...value, data: "43" }));
    expect(await client.get<number>("/number", { responseSchema: { parse } })).toBe(43);
    expect(parse).toHaveBeenCalledOnce();
    client.dispose();
  });

  it("enforces maxElapsedMs during an uncooperative Fetch attempt", async () => {
    vi.useFakeTimers();
    const transport = vi.fn(async () => new Promise<Response>(() => {}));
    const client = createHttpClient({ baseURL, fetch: transport });
    const work = client.get("/hang", {
      retry: { maxAttempts: 2, maxElapsedMs: 25 }
    });
    const result = expect(work).rejects.toMatchObject({ code: "TIMEOUT" });
    await vi.advanceTimersByTimeAsync(25);
    await result;
    expect(transport).toHaveBeenCalledTimes(1);
    client.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("honors retry elapsed deadline and prevents Retry-After override storms", async () => {
    const transport = vi.fn(async () => new Response(null, { status: 503, headers: { "retry-after": "3" } }));
    const client = createHttpClient({ baseURL, fetch: transport });
    await expect(client.get("/busy", {
      retry: { maxAttempts: 9, baseDelayMs: 1, maxElapsedMs: 10 }
    })).rejects.toMatchObject({ code: "HTTP_STATUS", status: 503 });
    expect(transport).toHaveBeenCalledTimes(1);
    client.dispose();
  });

  it("hands off explicitly requested native response streams without pre-consuming them", async () => {
    const client = createHttpClient({ baseURL, fetch: async () => new Response("stream-data") });
    const stream = await client.get<ReadableStream<Uint8Array>>("/stream", { responseType: "stream" });
    expect(stream).toBeInstanceOf(ReadableStream);
    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];
    while (true) { const item = await reader.read(); if (item.done) break; chunks.push(item.value); }
    expect(new TextDecoder().decode(chunks[0])).toBe("stream-data");
    client.dispose();
  });

  it("merges default and per-request headers with case-insensitive override", async () => {
    const observed: Headers[] = [];
    const client = createHttpClient({
      baseURL, headers: { "X-Tenant": "default", "Accept": "application/json" },
      fetch: async (_url, init) => {
        observed.push(new Headers(init?.headers));
        return new Response(null, { status: 204 });
      }
    });
    await client.get("/tenant", { headers: { "x-tenant": "override" } });
    expect(observed[0]?.get("x-tenant")).toBe("override");
    expect(observed[0]?.get("accept")).toBe("application/json");
    client.dispose();
  });

  it("uses real native Node Fetch against a loopback server", async () => {
    const server = createServer((req, res) => {
      if (req.url === "/v1/health" && req.method === "GET") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end('{"healthy":true}');
        return;
      }
      res.writeHead(204);
      res.end();
    });
    try {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
      });
      const port = (server.address() as AddressInfo).port;
      const client = createHttpClient({ baseURL: "http://127.0.0.1:" + port + "/v1/" });
      try {
        expect(await client.get("/health")).toEqual({ healthy: true });
        expect(await client.post("/save", { a: 1 })).toBeNull();
      } finally { client.dispose(); }
    } finally {
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });
});
