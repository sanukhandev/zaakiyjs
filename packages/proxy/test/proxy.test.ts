import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { allowedAddress, createNodeHttpHandler, createProxyRouter, MemoryRateLimitStore, ProxyConfigurationError } from "../src/index.js";
import type { ProxyConfig, ProxyOutgoing } from "../src/index.js";

const servers: Server[] = [];
async function listen(handler: Parameters<typeof createServer>[0]): Promise<number> {
  const server = createServer(handler);
  await new Promise<void>(done => server.listen(0, "127.0.0.1", done));
  servers.push(server);
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing local port");
  return address.port;
}
afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>(done => server.close(() => done()));
  }
});
function config(port: number, options: Partial<ProxyConfig> = {}): ProxyConfig {
  return {
    upstreams: { main: { origin: "http://127.0.0.1:" + port, allowInsecureHttp: true, allowedPrivateAddresses: ["127.0.0.1"] } },
    routes: [{ id: "items", path: "/api/items/*", upstream: "main", methods: ["GET", "POST"], access: "public" }],
    ...options
  };
}
const request = (method: string, url: string, headers: Record<string, string> = {}, body?: AsyncIterable<Uint8Array>) =>
  ({ method, url, headers, body, remoteAddress: "127.0.0.1" });
async function drain(response: ProxyOutgoing): Promise<Buffer> {
  const chunks: Uint8Array[] = [];
  if (response.body) for await (const chunk of response.body) chunks.push(chunk);
  return Buffer.concat(chunks);
}
const secure = (id = "secure") => ({ id, path: "/api/items/*", upstream: "main", methods: ["GET"] as const, access: "authenticated" as const, authorize: ({ principal }: { principal: { tenantId?: string } }) => principal.tenantId === "tenant-a" });

describe("route config and fail-closed boundary", () => {
  it("rejects undefined upstreams, invalid schemes, userinfo, path origins and missing auth", () => {
    expect(() => createProxyRouter({ upstreams: {}, routes: [{ id: "bad", path: "/x", methods: ["GET"], upstream: "missing", access: "public" }] })).toThrow(ProxyConfigurationError);
    for (const origin of ["file:///etc/passwd", "http://localhost:1", "https://api.example/path", "https://user:pass@api.example"]) {
      expect(() => createProxyRouter(config(1, { upstreams: { main: { origin } } })), origin).toThrow();
    }
    expect(() => createProxyRouter(config(1, { routes: [secure()] }))).toThrow();
    expect(() => createProxyRouter(config(1, { authenticate: () => ({ subject: "a" }), routes: [secure()] }))).not.toThrow();
    expect(() => createProxyRouter(config(1, { routes: [{ id: "x", path: "/x", upstream: "main", methods: ["GET"], access: "authenticated" }] }))).toThrow();
  });
  it("snapshots startup security policy so later configuration mutation cannot disable protection", async () => {
    const port = await listen((_req, res) => res.end("ok"));
    const mutableRoute = {
      id: "private", path: "/api/items/*", upstream: "main",
      methods: ["GET"], access: "authenticated" as "authenticated" | "public",
      authorize: () => false
    };
    const mutableUpstream = {
      origin: "http://127.0.0.1:" + port, allowedPrivateAddresses: ["127.0.0.1"],
      allowInsecureHttp: true
    };
    const options = {
      upstreams: { main: mutableUpstream },
      routes: [mutableRoute],
      authenticate: () => ({ subject: "alice" })
    };
    const router = createProxyRouter(options);
    mutableRoute.access = "public";
    mutableRoute.methods.push("POST");
    mutableRoute.authorize = () => true;
    mutableUpstream.origin = "http://169.254.169.254/";
    mutableUpstream.allowedPrivateAddresses.push("169.254.169.254");
    expect((await router.handle(request("GET", "/api/items/a"))).status).toBe(403);
    expect((await router.handle(request("POST", "/api/items/a"))).status).toBe(405);
  });
  it("fails startup on public routes with ignored authorization or unsafe identity policies", () => {
    const upstreams = config(1).upstreams;
    expect(() => createProxyRouter({ upstreams, routes: [{
      id: "open", path: "/open", upstream: "main", methods: ["GET"], access: "public",
      authorize: () => false
    }] })).toThrow("Public routes cannot silently ignore authorization");
    expect(() => createProxyRouter({ upstreams, routes: [{
      id: "limited", path: "/open", upstream: "main", methods: ["GET"], access: "public",
      rateLimit: { max: 2, windowMs: 1_000, by: "tenant" }
    }] })).toThrow("Public rate limiting requires trusted peer-address identity");
  });
  it("refuses request bodies on GET and HEAD at the proxy boundary", async () => {
    const proxy = createProxyRouter(config(1));
    const body = (async function* () { yield Buffer.from("payload"); })();
    for (const input of [
      request("GET", "/api/items/test", { "content-length": "7" }),
      request("GET", "/api/items/test", { "transfer-encoding": "chunked" }),
      request("GET", "/api/items/test", {}, body),
      request("HEAD", "/api/items/test", { "content-length": "7" })
    ]) {
      const response = await proxy.handle(input);
      expect(response.status).toBe(400);
      await drain(response);
    }
  });
  it("refuses route shadowing regardless of access priority", () => {
    expect(() => createProxyRouter(config(1, { routes: [
      { id: "open", path: "/api/*", upstream: "main", methods: ["GET"], access: "public" },
      { id: "secure", path: "/api/items", upstream: "main", methods: ["GET"], access: "public" }
    ] }))).toThrow();
  });
  it("rejects cross-policy intersections between parameterized routes", () => {
    const base = config(1);
    const routes = [
      { id: "public", path: "/api/:id/settings", upstream: "main", methods: ["GET"] as const, access: "public" as const },
      { id: "protected", path: "/api/admin/:section", upstream: "main", methods: ["GET"] as const,
        access: "authenticated" as const, authorize: () => false }
    ];
    expect(() => createProxyRouter({ ...base, routes, authenticate: () => ({ subject: "trusted" }) }))
      .toThrow("Ambiguous route overlap");
    expect(() => createProxyRouter({ ...base, routes: [
      { ...routes[0]!, path: "/api/user/settings" },
      { ...routes[1]!, path: "/api/admin/teams" }
    ], authenticate: () => ({ subject: "trusted" }) })).not.toThrow();
  });
  it("rejects multi-layer encoded traversal and encoded-percent path aliases", async () => {
    const proxy = createProxyRouter(config(1));
    for (const path of ["/api/items/%25%32%65%25%32%65/admin", "/api/items/%252e%252e/admin",
      "/api/items/%25%32%66/etc", "/api/items/%25", "/api/items/%25%35%63"]) {
      const response = await proxy.handle(request("GET", path));
      expect(response.status, path).toBe(400);
      await drain(response);
    }
  });
  it("rejects unregistered paths, wrong methods and URL authority attacks", async () => {
    const proxy = createProxyRouter(config(1));
    expect((await proxy.handle(request("GET", "/missing"))).status).toBe(404);
    expect((await proxy.handle(request("DELETE", "/api/items/x"))).status).toBe(405);
    for (const url of ["//evil/path", "http://evil/path", "/api/items/../x", "/api/items/%2e%2e/x", "/api/items/%252e%252e/x", "/api/items/%2fadmin", "/api/items/%5csecret", "/api/items/%GG", "/api/items/frag#x"]) {
      const response = await proxy.handle(request("GET", url));
      expect(response.status, url).toBe(400);
      await drain(response);
    }
    expect((await proxy.handle(request("CONNECT", "/api/items/x"))).status).toBe(400);
  });
});

describe("actual pinned DNS transport and forwarding", () => {
  it("connects to a resolved, explicitly allowed IP and preserves approved Host identity", async () => {
    const port = await listen((req, res) => {
      res.writeHead(200, { "content-type": "application/json", "set-cookie": "private=1", "x-internal-token": "secret", "location": "http://internal" });
      res.end(JSON.stringify({ host: req.headers.host, url: req.url, auth: req.headers.authorization ?? null, forwarded: req.headers["x-forwarded-for"] ?? null }));
    });
    const resolver = vi.fn(async () => [{ address: "127.0.0.1", family: 4 as const }]);
    const proxy = createProxyRouter(config(port, { upstreams: { main: { origin: "http://approved.example:" + port, allowInsecureHttp: true, allowedPrivateAddresses: ["127.0.0.1"] } }, resolver }));
    const response = await proxy.handle(request("GET", "/api/items/a?color=blue", { authorization: "Bearer untrusted", cookie: "secret=1", "x-forwarded-for": "8.8.8.8" }));
    expect(response.status).toBe(200);
    expect(response.headers["set-cookie"]).toBeUndefined();
    expect(response.headers["x-internal-token"]).toBeUndefined();
    expect(response.headers.location).toBeUndefined();
    expect(JSON.parse((await drain(response)).toString())).toEqual({ host: "approved.example:" + port, url: "/api/items/a?color=blue", auth: null, forwarded: null });
    expect(resolver).toHaveBeenCalledTimes(1);
  });
  it("rejects metadata, loopback, private, IPv6 mapping and DNS mixed answers", async () => {
    for (const ip of ["127.0.0.1", "10.0.0.1", "169.254.169.254", "192.168.1.1", "100.64.1.1", "::1", "::ffff:127.0.0.1", "fc00::1", "2002::1"]) {
      expect(allowedAddress(ip, { origin: "https://api.example" }), ip).toBe(false);
    }
    const port = await listen((_req, res) => res.end("SHOULD_NOT_CONNECT"));
    for (const answers of [[{ address: "127.0.0.1", family: 4 as const }], [{ address: "8.8.8.8", family: 4 as const }, { address: "169.254.169.254", family: 4 as const }]]) {
      const proxy = createProxyRouter(config(port, { upstreams: { main: { origin: "http://service.example:" + port, allowInsecureHttp: true } }, resolver: async () => answers }));
      const response = await proxy.handle(request("GET", "/api/items/1"));
      expect(response.status).toBe(400);
      await drain(response);
    }
    const alternate = createProxyRouter(config(port, { upstreams: { main: { origin: "http://0x7f000001:" + port, allowInsecureHttp: true } } }));
    expect((await alternate.handle(request("GET", "/api/items/1"))).status).toBe(400);
  });
  it("does not follow upstream redirects, including metadata redirects", async () => {
    const port = await listen((_req, res) => { res.writeHead(302, { location: "http://169.254.169.254/latest/meta-data" }); res.end(); });
    const response = await createProxyRouter(config(port)).handle(request("GET", "/api/items/redirect"));
    expect(response.status).toBe(400);
    expect((await drain(response)).toString()).not.toContain("169.254");
  });
  it("forwards JSON, multipart and binary data without corrupting bytes", async () => {
    const port = await listen(async (req, res) => {
      const chunks: Uint8Array[] = [];
      for await (const chunk of req) chunks.push(chunk);
      res.writeHead(200, { "content-type": req.headers["content-type"] ?? "application/octet-stream" });
      res.end(Buffer.concat(chunks));
    });
    const proxy = createProxyRouter(config(port));
    for (const [contentType, bytes] of [
      ["application/json", Buffer.from('{"key":1}')],
      ["multipart/form-data; boundary=abc", Buffer.from("--abc\r\nContent-Disposition: form-data; name=x\r\n\r\n1\r\n--abc--")],
      ["application/octet-stream", Buffer.from([0, 255, 2, 3])]
    ] as const) {
      const response = await proxy.handle(request("POST", "/api/items/upload", { "content-type": contentType }, (async function* () { yield bytes; })()));
      expect(response.status).toBe(200);
      expect(await drain(response)).toEqual(bytes);
    }
  });
  it("uses valid chunked framing for streamed DELETE and OPTIONS bodies", async () => {
    const port = await listen(async (req, res) => {
      const chunks: Uint8Array[] = [];
      for await (const chunk of req) chunks.push(chunk);
      const payload = Buffer.concat(chunks).toString("utf8");
      res.writeHead(payload === "binary-body" ? 200 : 400, { "content-type": "application/json" });
      res.end(JSON.stringify({
        method: req.method,
        payload,
        transferEncoding: req.headers["transfer-encoding"],
        contentLength: req.headers["content-length"] ?? null
      }));
    });
    const proxy = createProxyRouter(config(port, {
      routes: [{ id: "stream-methods", path: "/api/items/*", upstream: "main",
        methods: ["DELETE", "OPTIONS"], access: "public" }]
    }));
    for (const method of ["DELETE", "OPTIONS"]) {
      const bytes = Buffer.from("binary-body");
      const response = await proxy.handle(request(method, "/api/items/123", {
        "content-type": "application/octet-stream",
        "content-length": String(bytes.byteLength)
      }, (async function* () { yield bytes; })()));
      expect(response.status, method).toBe(200);
      expect(JSON.parse((await drain(response)).toString())).toEqual({
        method, payload: "binary-body", transferEncoding: "chunked", contentLength: null
      });
    }
  });
  it("strips Connection-nominated headers and rejects malformed query escapes", async () => {
    const port = await listen((req, res) => {
      expect(req.headers["x-sneaky"]).toBeUndefined();
      res.writeHead(200, { "content-type": "text/plain", connection: "x-hidden", "x-hidden": "secret" });
      res.end("safe");
    });
    const proxy = createProxyRouter(config(port, { routes: [{
      id: "custom", path: "/api/items/*", upstream: "main", methods: ["GET"], access: "public",
      requestHeaders: ["x-sneaky"], responseHeaders: ["x-hidden"]
    }] }));
    const invalid = await proxy.handle(request("GET", "/api/items/1?bad=%GG"));
    expect(invalid.status).toBe(400); await drain(invalid);
    const valid = await proxy.handle(request("GET", "/api/items/1", { connection: "x-sneaky", "x-sneaky": "secret" }));
    expect(valid.status).toBe(200);
    expect(valid.headers["x-hidden"]).toBeUndefined();
    expect((await drain(valid)).toString()).toBe("safe");
  });
  it("rejects oversized streamed bodies even if upstream replies before reading", async () => {
    const port = await listen((_req, res) => { res.writeHead(200); res.end("early success"); });
    const proxy = createProxyRouter(config(port, { routes: [{
      id: "stream", path: "/api/items/*", upstream: "main", methods: ["POST"], access: "public",
      maxRequestBytes: 4
    }] }));
    const body = (async function* () {
      yield Buffer.from("a");
      await new Promise(done => setTimeout(done, 10));
      yield Buffer.from("too-large");
    })();
    const response = await proxy.handle(request("POST", "/api/items/upload", {}, body));
    expect(response.status).toBe(413);
    await drain(response);
  });
  it("enforces request and response byte caps", async () => {
    const port = await listen((_req, res) => { res.writeHead(200, { "content-length": "1024" }); res.end(Buffer.alloc(1024)); });
    const limited = createProxyRouter(config(port, { upstreams: { main: { origin: "http://127.0.0.1:" + port, allowedPrivateAddresses: ["127.0.0.1"], allowInsecureHttp: true, maxResponseBytes: 16 } } }));
    expect((await limited.handle(request("GET", "/api/items/1"))).status).toBe(502);
    const bodyLimited = createProxyRouter(config(port, { routes: [{ id: "upload", path: "/api/items/*", methods: ["POST"], upstream: "main", access: "public", maxRequestBytes: 2 }] }));
    const big = await bodyLimited.handle(request("POST", "/api/items/1", { "content-length": "900" }, (async function* () { yield Buffer.alloc(900); })()));
    expect(big.status).toBe(413); await drain(big);
  });
});

describe("authentication, tenant isolation and cancellation", () => {
  it("requires trusted principal; client tenant header cannot override identity", async () => {
    const port = await listen((_req, res) => res.end("ok"));
    const authorize = vi.fn(({ principal }: { principal: { tenantId?: string } }) => principal.tenantId === "tenant-a");
    const proxy = createProxyRouter(config(port, {
      authenticate: ({ request }) => request.headers.authorization === "Bearer verified" ? { subject: "alice", tenantId: "tenant-a" } : null,
      routes: [{ ...secure(), authorize }]
    }));
    expect((await proxy.handle(request("GET", "/api/items/1", { "x-tenant-id": "tenant-a" }))).status).toBe(401);
    const valid = await proxy.handle(request("GET", "/api/items/1", { authorization: "Bearer verified", "x-tenant-id": "tenant-b" }));
    expect(valid.status).toBe(200); await drain(valid);
    expect(authorize).toHaveBeenCalledWith(expect.objectContaining({ principal: expect.objectContaining({ tenantId: "tenant-a" }) }));
    const denied = createProxyRouter(config(port, { authenticate: () => ({ subject: "bob", tenantId: "tenant-b" }), routes: [{ ...secure(), authorize }] }));
    expect((await denied.handle(request("GET", "/api/items/1"))).status).toBe(403);
  });
  it("rate limits peer identity, expires counters and ignores forged forwarding headers", async () => {
    const store = new MemoryRateLimitStore(2);
    expect(store.check({ key: "tenant:a", max: 1, windowMs: 100, now: 0 }).allowed).toBe(true);
    expect(store.check({ key: "tenant:a", max: 1, windowMs: 100, now: 1 }).allowed).toBe(false);
    expect(store.check({ key: "tenant:a", max: 1, windowMs: 100, now: 101 }).allowed).toBe(true);
    const port = await listen((_req, res) => res.end("ok"));
    const proxy = createProxyRouter(config(port, { routes: [{ id: "limited", path: "/api/items/*", methods: ["GET"], upstream: "main", access: "public", rateLimit: { by: "address", max: 1, windowMs: 100_000 } }] }));
    const first = await proxy.handle(request("GET", "/api/items/1", { "x-forwarded-for": "1.2.3.4" }));
    expect(first.status).toBe(200); await drain(first);
    const second = await proxy.handle(request("GET", "/api/items/1", { "x-forwarded-for": "5.6.7.8" }));
    expect(second.status).toBe(429); expect(second.headers["retry-after"]).toBeTruthy(); await drain(second);
  });
  it("enforces deadline even when a user authentication adapter never resolves", async () => {
    const port = await listen((_req, res) => res.end("NEVER"));
    const proxy = createProxyRouter(config(port, {
      authenticate: () => new Promise(() => {}),
      routes: [{ ...secure(), timeoutMs: 25 }]
    }));
    const response = await proxy.handle(request("GET", "/api/items/1"));
    expect(response.status).toBe(504);
    await drain(response);
  });
  it("uses a real Node HTTP adapter with no browser framework imports", async () => {
    const upstream = await listen((_req, res) => { res.setHeader("content-type", "text/plain"); res.end("node-adapter"); });
    const proxy = createProxyRouter(config(upstream));
    const gateway = await listen(createNodeHttpHandler(proxy));
    const response = await fetch("http://127.0.0.1:" + gateway + "/api/items/x");
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("node-adapter");
  });
});
