import { afterEach, describe, expect, it, vi } from "vitest";
import { createHttpClient, HttpError } from "../src/index.js";
import { createResource, createTask } from "../../async/src/index.js";
const baseURL = "https://api.example.test/v1/";
const json = (data: unknown, status = 200): Response => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
describe("@zaakiyjs/http", () => {
  it("supports method shorthands, query arrays and JSON bodies", async () => {
    const seen: Array<{ url: string; method: string; headers: Headers; body: BodyInit | null | undefined }> = [];
    const client = createHttpClient({ baseURL, fetch: async (url, init) => {
      seen.push({ url: String(url), method: init?.method ?? "", headers: new Headers(init?.headers), body: init?.body });
      return json({ ok: true });
    } });
    await client.get("/people", { query: { tags: ["a", "b"], page: 3 } });
    await client.post("/people", { name: "Ada" });
    await client.put("/people/1", { name: "Grace" });
    await client.patch("/people/1", { name: "Lin" });
    await client.delete("/people/1");
    expect(seen.map(x => x.method)).toEqual(["GET", "POST", "PUT", "PATCH", "DELETE"]);
    expect(new URL(seen[0]!.url).pathname).toBe("/v1/people");
    expect(new URL(seen[0]!.url).searchParams.getAll("tags")).toEqual(["a", "b"]);
    expect(seen[1]?.body).toBe('{"name":"Ada"}');
    expect(seen[1]?.headers.get("content-type")).toBe("application/json");
    client.dispose();
  });

  it("parses text, empty bodies, binary data and preserves multipart boundaries", async () => {
    const observed: RequestInit[] = [];
    let next = new Response("hi", { headers: { "content-type": "text/plain" } });
    const client = createHttpClient({ baseURL, fetch: async (_, init) => { observed.push(init ?? {}); return next; } });
    expect(await client.get("/text")).toBe("hi");
    next = new Response(null, { status: 204 });
    expect(await client.get("/empty")).toBeNull();
    next = new Response(null, { status: 205 });
    expect(await client.get("/reset")).toBeNull();
    next = new Response("binary");
    const bytes = await client.get<ArrayBuffer>("/binary", { responseType: "arrayBuffer" });
    expect(new TextDecoder().decode(bytes)).toBe("binary");
    next = new Response("form-ack", { headers: { "content-type": "text/plain" } });
    const form = new FormData(); form.set("name", "Ada");
    await client.post("/form", form, { responseType: "text" });
    expect(new Headers(observed.at(-1)?.headers).has("content-type")).toBe(false);
    next = new Response("urlencoded-ack", { headers: { "content-type": "text/plain" } });
    await client.post("/urlencoded", new URLSearchParams({ a: "1" }), { responseType: "text" });
    expect(new Headers(observed.at(-1)?.headers).get("content-type")).toContain("application/x-www-form-urlencoded");
    client.dispose();
  });

  it("enforces body limit, invalid JSON classification and typed validators", async () => {
    const tooLarge = createHttpClient({ baseURL, fetch: async () => json({ secret: "value" }) });
    await expect(tooLarge.get("/large", { maxResponseBytes: 4 })).rejects.toMatchObject({ code: "UNSUPPORTED" });
    tooLarge.dispose();
    const broken = createHttpClient({ baseURL, fetch: async () => new Response("{", { headers: { "content-type": "application/json" } }) });
    await expect(broken.get("/bad")).rejects.toMatchObject({ code: "PARSE" });
    broken.dispose();
    const client = createHttpClient({ baseURL, fetch: async () => json({ count: "not-a-number" }) });
    await expect(client.get<{ count: number }>("/schema", {
      responseSchema: { parse(value) {
        if (!value || typeof value !== "object" || typeof (value as { count?: unknown }).count !== "number") throw Error("invalid");
        return value as { count: number };
      } }
    })).rejects.toMatchObject({ code: "RESPONSE_VALIDATION" });
    client.dispose();
  });

  it("orders interceptors, prevents duplicates and supports removal and short circuit", async () => {
    const events: string[] = [];
    const fetch = vi.fn(async (_url: URL | RequestInfo, init?: RequestInit) => {
      expect(new Headers(init?.headers).get("x-trace")).toBe("1");
      return json({ data: 1 });
    });
    const client = createHttpClient({ baseURL, fetch });
    const trace = (ctx: { headers: Headers }): void => { events.push("q1"); ctx.headers.set("x-trace", "1"); };
    const remove = client.interceptors.request.use(trace);
    client.interceptors.request.use(trace);
    client.interceptors.request.use(ctx => { events.push("q2"); ctx.headers.set("x-trace", "1"); });
    client.interceptors.response.use(r => { events.push("r1"); return { ...r, data: { data: 2 } }; });
    client.interceptors.response.use(r => { events.push("r2"); return r; });
    expect(await client.get("/ok")).toEqual({ data: 2 });
    expect(events).toEqual(["q1", "q2", "r1", "r2"]);
    remove();
    events.length = 0;
    await client.get("/ok");
    expect(events).toEqual(["q2", "r1", "r2"]);
    client.interceptors.request.clear();
    client.interceptors.request.use(() => json({ local: true }));
    expect(await client.get("/cache")).toEqual({ data: 2 });
    expect(fetch).toHaveBeenCalledTimes(2);
    client.dispose();
  });

  it("enforces origin, redirect and sensitive header restrictions without leaking error bodies", async () => {
    const fetch = vi.fn(async () => json({ ok: true }));
    const client = createHttpClient({ baseURL, fetch, allowedOrigins: ["https://other.example.test"] });
    for (const path of ["javascript:alert(1)", "//bad.example.test", "https://bad.example.test"]) {
      await expect(client.get(path)).rejects.toMatchObject({ code: "INVALID_CONFIG" });
    }
    await expect(client.get("/ok", { redirect: "follow" as "error" })).rejects.toMatchObject({ code: "INVALID_CONFIG" });
    await expect(client.get("https://other.example.test/data")).rejects.toMatchObject({ code: "INVALID_CONFIG" });
    await expect(client.get("https://other.example.test/data", {
      credentials: "omit", headers: { authorization: "token-secret" }
    })).rejects.toMatchObject({ code: "INVALID_CONFIG" });
    expect(await client.get("https://other.example.test/data", { credentials: "omit" })).toEqual({ ok: true });
    client.dispose();
    const denied = createHttpClient({ baseURL, fetch: async () => new Response("secret-token", { status: 403 }) });
    try { await denied.get("/fail"); } catch (err) {
      expect(err).toBeInstanceOf(HttpError);
      expect(String(err)).not.toContain("secret-token");
    }
    denied.dispose();
  });

  it("classifies abort, timeout, network failures and permanent disposal", async () => {
    const client = createHttpClient({ baseURL, fetch: async () => new Promise<Response>(() => {}) });
    const controller = new AbortController();
    const pending = client.get("/pending", { signal: controller.signal });
    controller.abort("caller");
    await expect(pending).rejects.toMatchObject({ code: "CANCELLED", cause: "caller" });
    vi.useFakeTimers();
    const timed = client.get("/pending", { timeoutMs: 10 });
    const checked = expect(timed).rejects.toMatchObject({ code: "TIMEOUT" });
    await vi.advanceTimersByTimeAsync(10);
    await checked;
    const stopped = client.get("/pending");
    client.dispose();
    await expect(stopped).rejects.toMatchObject({ code: "CANCELLED" });
    expect(vi.getTimerCount()).toBe(0);
    await expect(client.get("/again")).rejects.toMatchObject({ code: "DISPOSED" });
    const offline = createHttpClient({ baseURL, fetch: async () => { throw Error("offline"); } });
    await expect(offline.get("/x")).rejects.toMatchObject({ code: "NETWORK" });
    offline.dispose();
  });

  it("aborts during asynchronous interceptors and retry delay", async () => {
    const wait = createHttpClient({ baseURL, fetch: async () => json(1) });
    wait.interceptors.request.use(() => new Promise<void>(() => {}));
    const controller = new AbortController();
    const pending = wait.get("/wait", { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: "CANCELLED" });
    wait.dispose();
    let attempts = 0;
    const fail = createHttpClient({ baseURL, fetch: async () => { attempts++; return new Response(null, { status: 503 }); } });
    const abort = new AbortController();
    const work = fail.get("/retry", { signal: abort.signal, retry: { maxAttempts: 3, baseDelayMs: 1000 } });
    await vi.waitFor(() => expect(attempts).toBe(1));
    abort.abort();
    await expect(work).rejects.toMatchObject({ code: "CANCELLED" });
    expect(attempts).toBe(1);
    fail.dispose();
  });

  it("retries only eligible requests with bounded attempts", async () => {
    let attempts = 0;
    const client = createHttpClient({ baseURL, fetch: async () => {
      attempts++; return attempts <= 2 ? new Response(null, { status: 503 }) : json({ ok: true });
    } });
    expect(await client.get("/retry", { retry: { maxAttempts: 3, baseDelayMs: 0, maxDelayMs: 0 } })).toEqual({ ok: true });
    expect(attempts).toBe(3);
    await expect(client.post("/write", { id: 1 }, { retry: { maxAttempts: 3 } }))
      .rejects.toMatchObject({ code: "INVALID_CONFIG" });
    expect(attempts).toBe(3);
    client.dispose();
  });

  it("coordinates single-flight token refresh without replaying it indefinitely", async () => {
    let refreshCount = 0;
    let current = "old";
    const client = createHttpClient({
      baseURL,
      auth: {
        getToken: async () => current,
        refreshToken: async () => { refreshCount++; current = "new"; return current; }
      },
      fetch: async (_url, init) =>
        new Headers(init?.headers).get("authorization") === "Bearer new" ?
          json({ ok: true }) : new Response(null, { status: 401 })
    });
    expect(await Promise.all([client.get("/a"), client.get("/b")])).toEqual([{ ok: true }, { ok: true }]);
    expect(refreshCount).toBe(1);
    client.dispose();
  });

  it("uses the actual async resource/task API without HTTP-level state ownership", async () => {
    let reads = 0;
    const client = createHttpClient({ baseURL, fetch: async (_url, init) => {
      if (init?.method === "GET") { reads++; return json({ id: 1 }); }
      return json({ created: true });
    } });
    const resource = createResource({ owner: null, load: ({ signal }) => client.get<{ id: number }>("/read", { signal }) });
    const task = createTask({ owner: null, execute: ({ input, signal }: { input: string; signal: AbortSignal }) =>
      client.post<{ created: boolean }, string>("/write", input, { signal }) });
    expect(await resource.refresh()).toEqual({ id: 1 });
    expect(reads).toBe(1);
    expect(await task.run("mutation")).toEqual({ created: true });
    resource.dispose(); task.dispose(); client.dispose();
  });

  it("does not patch AbortController or Promise", () => {
    const ctor = globalThis.AbortController;
    const then = Promise.prototype.then;
    const client = createHttpClient({ baseURL, fetch: async () => json("ok") });
    client.dispose();
    expect(globalThis.AbortController).toBe(ctor);
    expect(Promise.prototype.then).toBe(then);
  });
});
