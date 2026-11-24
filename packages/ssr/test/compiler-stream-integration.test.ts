import { describe, expect, it } from "vitest";
import { compileDataServer } from "../../compiler/src/index.js";
import { buildVerifiedManifestV1 } from "../src/build.js";
import { createByteAttestedNodeServerAdapter } from "../src/node.js";
import type { TrustedServerRenderModuleV1 } from "../src/protocol.js";

describe("E6 — compiled streamed HTML through attested Node adapter", () => {
  it("escapes loader data, isolates requests and supports HEAD over trusted artifacts", async () => {
    const compiled = compileDataServer({
      fileName: "packages/ssr/test/product-page.tsx",
      routeId: "product",
      streaming: true,
      source: "function Product(props: { product: { name: string } }) {" +
        "return <main><h1>{props.product.name}</h1></main>;}"
    });
    expect(compiled.diagnostics.filter(d => d.severity === "error")).toEqual([]);
    const source = compiled.js[0]!.code;
    const bytes = new TextEncoder().encode(source);
    const moduleUrl = "data:text/javascript;base64," + Buffer.from(bytes).toString("base64");
    const module = await import(/* @vite-ignore */ moduleUrl) as TrustedServerRenderModuleV1;
    const manifest = buildVerifiedManifestV1([
      { routeId: "product", moduleId: "generated/product", bytes }
    ]);
    const adapter = createByteAttestedNodeServerAdapter({
      origin: "https://shop.example.test",
      routes: [{ id: "product", path: "/products/:slug",
        loader: ({ params }) => ({ product: { name: params.slug } }) }],
      policies: [{ version: 1, routeId: "product", mode: "ssr" }],
      manifest,
      modules: {
        "generated/product": {
          sourceDigest: manifest.routes.product!.sourceDigest, module
        }
      }
    }, { "generated/product": bytes });
    const request = async (slug: string, method: "GET" | "HEAD" = "GET") =>
      adapter.handle(new Request("https://shop.example.test/products/" + encodeURIComponent(slug), { method }),
        { signal: new AbortController().signal });
    const [first, second] = await Promise.all([request("<script>alert(1)</script>"), request("other")]);
    const [a, b] = await Promise.all([first.text(), second.text()]);
    expect(first.status).toBe(200);
    expect(a).toContain("&lt;script&gt;");
    expect(a).not.toContain("<script>");
    expect(b).toContain("other");
    expect(b).not.toContain("alert(1)");
    expect(first.headers.get("cache-control")).toBe("private, no-store");

    const head = await request("other", "HEAD");
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
    expect(head.headers.get("x-content-type-options")).toBe("nosniff");

    expect(() => createByteAttestedNodeServerAdapter({
      origin: "https://shop.example.test",
      routes: [{ id: "product", path: "/products/:slug" }],
      policies: [{ version: 1, routeId: "product", mode: "ssr" }],
      manifest,
      modules: { "generated/product": { sourceDigest: manifest.routes.product!.sourceDigest, module } }
    }, { "generated/product": new TextEncoder().encode("tampered") })).toThrow(/bytes do not match/);
  });
});