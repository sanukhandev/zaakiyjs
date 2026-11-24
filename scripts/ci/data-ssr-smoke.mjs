#!/usr/bin/env node
/** Compiled read-only loaderData -> byte-verified ESM -> real SSR HTTP adapter. */
import assert from "node:assert/strict";
import { compileDataServer } from "../../packages/compiler/dist/index.js";
import { buildVerifiedManifestV1 } from "../../packages/ssr/dist/build.js";
import { createByteAttestedNodeServerAdapter } from "../../packages/ssr/dist/node.js";

const result = compileDataServer({
  fileName: "fixtures/data-product.tsx",
  routeId: "item",
  source: [
    "function Page(props: { customer: { name: string }; order: number }) {",
    'return <main class="item"><h1>{props.customer.name}</h1><p>{props.order}</p></main>;',
    "}"
  ].join("\n")
});
assert.deepEqual(result.diagnostics.filter(d => d.severity === "error"), []);
assert.deepEqual(result.dynamicPaths, [["customer", "name"], ["order"]]);
assert.equal(result.js.length, 1);
const code = result.js[0].code;
assert.ok(!code.includes("@zaakiyjs/compiler") && !code.includes("props.customer"));
const emittedBytes = new globalThis.TextEncoder().encode(code);
const manifest = buildVerifiedManifestV1([
  { routeId: "item", moduleId: "compiled/item", bytes: emittedBytes }
]);
const module = await import("data:text/javascript;base64," +
  globalThis.Buffer.from(emittedBytes).toString("base64"));
assert.equal(module.protocol, "zaakiy.render/1");
const options = {
  origin: "https://secure.example.test",
  routes: [{
    id: "item", path: "/items/:slug",
    loader: ({ params }) => ({ customer: { name: params.slug === "attack" ? "<script>alert(1)</script>" : params.slug }, order: 1 })
  }],
  policies: [{ version: 1, routeId: "item", mode: "ssr" }],
  manifest,
  modules: {
    "compiled/item": {
      sourceDigest: manifest.routes.item.sourceDigest,
      module: { protocol: module.protocol, render: module.render }
    }
  }
};
const server = createByteAttestedNodeServerAdapter(options, { "compiled/item": emittedBytes });
const read = (slug, method = "GET") =>
  server.handle(new globalThis.Request("https://secure.example.test/items/" + slug, { method }),
    { signal: new globalThis.AbortController().signal });
const [a, b] = await Promise.all([read("Ada"), read("Lin")]);
assert.equal(a.status, 200);
assert.equal(b.status, 200);
assert.equal(await a.text(), '<main class="item"><h1>Ada</h1><p>1</p></main>');
assert.equal(await b.text(), '<main class="item"><h1>Lin</h1><p>1</p></main>');
assert.equal(a.headers.get("cache-control"), "private, no-store");
const injected = await read("attack");
assert.equal(injected.status, 200);
const escaped = await injected.text();
assert.ok(!escaped.includes("<script>"));
assert.ok(escaped.includes("&lt;script&gt;"));
const head = await read("Ada", "HEAD");
assert.equal(head.status, 200);
assert.equal(await head.text(), "");
const notFound = await server.handle(
  new globalThis.Request("https://secure.example.test/missing"),
  { signal: new globalThis.AbortController().signal }
);
assert.equal(notFound.status, 404);
assert.throws(() => createByteAttestedNodeServerAdapter(options, {
  "compiled/item": new globalThis.TextEncoder().encode(code + "\n// modified")
}), /bytes do not match/);

// Call the compiled renderer directly with a malicious accessor; never
// evaluate getters or user-supplied code during string rendering.
let reads = 0;
const malicious = Object.defineProperty({}, "name", { enumerable: true,
  get() { reads++; throw new Error("getter executed"); } });
assert.throws(() => module.render({
  schema: "zaakiy.render/1", route: { id: "item" },
  request: { signal: new globalThis.AbortController().signal },
  loaderData: { customer: malicious, order: 1 }
}), /getters are forbidden/);
assert.equal(reads, 0);

const oversized = { customer: { name: "x".repeat(65537) }, order: 1 };
assert.throws(() => module.render({
  schema: "zaakiy.render/1", route: { id: "item" },
  request: { signal: new globalThis.AbortController().signal },
  loaderData: oversized
}), /text limit/);
console.log("DATA_SSR_HTTP_SMOKE PASS: concurrent data, escaping, getter rejection, no-store, HEAD, 404, artifact bytes");
