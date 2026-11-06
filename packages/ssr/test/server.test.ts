import { describe, expect, it } from "vitest";
import { createContext, getOwner, onCleanup, provide as coreProvide } from "@zaakiyjs/core";
import { createNodeServerAdapter, MemoryRenderCache, createCacheInvalidator } from "../src/node.js";
import type { ServerOptions } from "../src/node.js";
import type { RenderResponseV1, TrustedServerBuildManifestV1, ServerRequestContextV1 } from "../src/protocol.js";

const digest = "a".repeat(64);
const sourceDigest = "b".repeat(64);
const manifest: TrustedServerBuildManifestV1 = {
  schema: "zaakiy.render-manifest/1", buildId: digest, irVersion: 1, domAbiVersion: 1,
  routes: { item: { moduleId: "built/item", sourceDigest, routeId: "item" } }
};
const token = createContext<string>("request");
function fixture(render?: (ctx: ServerRequestContextV1) => RenderResponseV1 | Promise<RenderResponseV1>,
  overrides: Partial<ServerOptions> = {}): ServerOptions {
  return {
    origin: "https://shop.example.test",
    routes: [{ id: "item", path: "/products/:slug", loader: ({ params }) => params.slug }],
    policies: [{ version: 1, routeId: "item", mode: "ssr" }],
    manifest, modules: { "built/item": { sourceDigest, module: { protocol: "zaakiy.render/1",
      render: render ?? (ctx => ({
        version: 1, status: 200, headers: {}, body: "<main>" + String(ctx.loaderData) + "</main>",
        cache: { scope: "no-store", tags: [] }
      })) } } },
    ...overrides
  };
}
async function get(options: ServerOptions, path = "/products/a", signal = new AbortController().signal): Promise<Response> {
  return createNodeServerAdapter(options).handle(new Request("https://shop.example.test" + path), { signal });
}
describe("SSR request / trusted-module boundary", () => {
  it("uses the existing Router matcher and passes dynamic loader data", async () => {
    const response = await get(fixture());
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("<main>a</main>");
    expect((await get(fixture(), "/no-match")).status).toBe(404);
  });
  it("isolates concurrent Core owners, providers and cleanup", async () => {
    const seen = new Set<unknown>();
    const disposed: string[] = [];
    const options = fixture(async context => {
      expect(getOwner()).toBe(context.owner);
      seen.add(context.owner);
      onCleanup(() => disposed.push(String(context.loaderData)));
      await Promise.resolve();
      return { version: 1, status: 200, headers: {}, body: context.services.require(token),
        cache: { scope: "no-store", tags: [] } };
    }, {
      provide: (owner, request) => { coreProvide(owner, token, new URL(request.url).pathname); }
    });
    const [a,b] = await Promise.all([get(options, "/products/1"), get(options, "/products/2")]);
    expect(await a.text()).toBe("/products/1");
    expect(await b.text()).toBe("/products/2");
    expect(seen.size).toBe(2);
    expect(disposed).toEqual(expect.arrayContaining(["1", "2"]));
  });
  it("returns correct denial, redirect, gone and method statuses", async () => {
    const denied = fixture(undefined, { routes: [{ id: "item", path: "/products/:slug", guard: () => false }] });
    expect((await get(denied)).status).toBe(403);
    const redirected = fixture(undefined, {
      routes: [{ id: "item", path: "/products/:slug", guard: () => ({ redirect: "/login" }) }]
    });
    const redirect = await get(redirected);
    expect(redirect.status).toBe(307);
    expect(redirect.headers.get("location")).toBe("/login");
    expect((await get(fixture(() => ({ version: 1, status: 410, headers: {},
      body: "Gone", cache: { scope: "no-store", tags: [] } })))).status).toBe(410);
    const adapter = createNodeServerAdapter(fixture());
    expect((await adapter.handle(new Request("https://shop.example.test/", { method: "POST" }),
      { signal: new AbortController().signal })).status).toBe(405);
  });
  it("rejects unregistered modules and cross-origin redirect responses", async () => {
    expect(() => createNodeServerAdapter(fixture(undefined, { modules: {} }))).toThrow(/trusted server module/i);
    const injected = fixture(() => ({ version: 1, status: 302,
      headers: { location: "https://attacker.test/" }, body: "", cache: { scope: "no-store", tags: [] } }));
    expect((await get(injected)).status).toBe(500);
    expect((await get(fixture(), "/products/%2e%2e")).status).not.toBe(200);
  });
  it("handles HEAD and aborts cancelled requests without exposing errors", async () => {
    const adapter = createNodeServerAdapter(fixture());
    const head = await adapter.handle(new Request("https://shop.example.test/products/a", { method: "HEAD" }),
      { signal: new AbortController().signal });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
    const controller = new AbortController();
    const blocked = createNodeServerAdapter(fixture(async () => {
      await new Promise(resolve => setTimeout(resolve, 50));
      return { version: 1, status: 200, headers: {}, body: "late", cache: { scope: "no-store", tags: [] } };
    })).handle(new Request("https://shop.example.test/products/a"), { signal: controller.signal });
    controller.abort();
    expect((await blocked).status).toBe(503);
  });
  it("disposes a streaming request on host cancellation without a body reader", async () => {
    let disposed = false;
    const controller = new AbortController();
    const adapter = createNodeServerAdapter(fixture(() => {
      onCleanup(() => { disposed = true; });
      return { version: 1, status: 200, headers: {},
        body: (async function* () { await new Promise(resolve => setTimeout(resolve, 100)); yield new Uint8Array([65]); })(),
        cache: { scope: "no-store", tags: [] } };
    }));
    const response = await adapter.handle(new Request("https://shop.example.test/products/a"),
      { signal: controller.signal });
    expect(response.status).toBe(200);
    controller.abort();
    expect(disposed).toBe(true);
  });
  it("supports backpressure-driven transport streams with owner disposal", async () => {
    let disposed = false;
    const response = await get(fixture(() => {
      onCleanup(() => { disposed = true; });
      return { version: 1, status: 200, headers: {},
        body: (async function* () { yield new Uint8Array([97]); yield new Uint8Array([98]); })(),
        cache: { scope: "no-store", tags: [] } };
    }));
    expect(await response.text()).toBe("ab");
    expect(disposed).toBe(true);
  });
});
describe("hybrid cache and revalidation", () => {
  it("does not persist a regeneration invalidated while its response is in flight", async () => {
    const cache = new MemoryRenderCache();
    const identity = { routeId: "p", buildId: "a".repeat(64), scope: "public" as const,
      tags: ["product:x"], ttlSeconds: 30 };
    let finish: ((result: RenderResponseV1) => void) | undefined;
    const waiting = cache.getOrRender("p", identity, () => new Promise(resolve => { finish = resolve; }));
    cache.invalidateTags("public", undefined, ["product:x"]);
    finish!({ version: 1, status: 200, headers: {}, body: "old",
      cache: { scope: "public", tags: ["product:x"] } });
    expect((await waiting).body).toBe("old");
    expect(cache.size).toBe(0);
  });
  it("deduplicates regeneration, scopes tenants, revalidates TTL, and checks invalidation auth", async () => {
    let now = 1_000_000;
    const cache = new MemoryRenderCache(4, () => now);
    let calls = 0;
    const server = fixture(async ctx => ({ version: 1, status: 200, headers: {},
      body: ctx.principal.partitionKey + ":" + ++calls,
      cache: { scope: "tenant", tags: ["product:a"] } }), {
      policies: [{ version: 1, routeId: "item", mode: "hybrid",
        cache: { scope: "tenant", ttlSeconds: 10, tags: ["product:a"] } }],
      resolvePrincipal: request => ({ scope: "tenant", partitionKey: request.headers.get("x-test-tenant") ?? "none" }),
      cache
    });
    const adapter = createNodeServerAdapter(server);
    const ask = async (tenant: string) => (await adapter.handle(new Request("https://shop.example.test/products/a",
      { headers: { "x-test-tenant": tenant } }), { signal: new AbortController().signal })).text();
    const [first, second] = await Promise.all([ask("t1"), ask("t1")]);
    expect(first).toBe(second);
    expect(calls).toBe(1);
    expect(await ask("t2")).not.toBe(first);
    expect(calls).toBe(2);
    expect(await ask("t1")).toBe(first);
    now += 11_000;
    expect(await ask("t1")).not.toBe(first);
    const invalidator = createCacheInvalidator(cache, async input => input.principalId === "admin", () => now);
    const invalidation = { version: 1 as const, tags: ["product:a"], scope: "tenant" as const,
      partitionKey: "t2", principalId: "admin", issuedAt: new Date(now).toISOString(), idempotencyKey: "req1" };
    await expect(invalidator.invalidate({ ...invalidation, principalId: "guest" },
      new AbortController().signal)).rejects.toThrow();
    expect((await invalidator.invalidate(invalidation, new AbortController().signal)).invalidatedCount).toBe(1);
    expect((await invalidator.invalidate(invalidation, new AbortController().signal)).invalidatedCount).toBe(0);
  });
});
