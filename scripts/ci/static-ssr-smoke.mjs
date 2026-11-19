#!/usr/bin/env node
/**
 * Build-to-HTTP integration gate for the literal-only compiler SSR slice.
 * Runs after pnpm build. The emitted module is imported as trusted build bytes,
 * never from a request URL or arbitrary user-provided input.
 */
import assert from "node:assert/strict";
import { compileStaticServer } from "../../packages/compiler/dist/index.js";
import { buildVerifiedManifestV1 } from "../../packages/ssr/dist/build.js";
import { createByteAttestedNodeServerAdapter } from "../../packages/ssr/dist/node.js";

const result = compileStaticServer({
  fileName: "fixtures/static-home.tsx",
  routeId: "home",
  source: 'function Home(){return <main><h1>ZaakiyJS static SSR</h1><p>{"<unsafe>&"}</p></main>;}'
});
assert.deepEqual(result.diagnostics.filter(item => item.severity === "error"), []);
assert.equal(result.js.length, 1);
const emitted = result.js[0].code;
assert.ok(!emitted.includes("@zaakiyjs/compiler"));
assert.ok(!emitted.includes("@zaakiyjs/dom"));
const bytes = new globalThis.TextEncoder().encode(emitted);
const manifest = buildVerifiedManifestV1([
  { routeId: "home", moduleId: "compiled/home", bytes }
]);
// The import is authorized by this deterministic build/test fixture, not an
// HTTP request. Production must use an immutable attested module registry.
const module = await import("data:text/javascript;base64," + globalThis.Buffer.from(bytes).toString("base64"));
assert.equal(module.protocol, "zaakiy.render/1");
assert.equal(typeof module.render, "function");
const modules = { "compiled/home": {
  sourceDigest: manifest.routes.home.sourceDigest,
  module: { protocol: module.protocol, render: module.render }
} };
const options = {
  origin: "https://zaa.example.test",
  routes: [{ id: "home", path: "/" }],
  policies: [{ version: 1, routeId: "home", mode: "ssr" }],
  manifest,
  modules
};
const server = createByteAttestedNodeServerAdapter(options, { "compiled/home": bytes });
const request = (method = "GET") => server.handle(
  new globalThis.Request("https://zaa.example.test/", { method }),
  { signal: new globalThis.AbortController().signal }
);
const response = await request();
assert.equal(response.status, 200);
assert.equal(response.headers.get("cache-control"), "private, no-store");
assert.equal(await response.text(),
  "<main><h1>ZaakiyJS static SSR</h1><p>&lt;unsafe&gt;&amp;</p></main>");
const head = await request("HEAD");
assert.equal(head.status, 200);
assert.equal(await head.text(), "");
const notFound = await server.handle(
  new globalThis.Request("https://zaa.example.test/unregistered"),
  { signal: new globalThis.AbortController().signal }
);
assert.equal(notFound.status, 404);
assert.throws(() => createByteAttestedNodeServerAdapter(options, {
  "compiled/home": new globalThis.TextEncoder().encode(emitted + "\n// modified")
}), /bytes do not match/);
console.log("STATIC_SSR_HTTP_SMOKE PASS: build bytes, manifest, HTTP response, HEAD, 404 and tamper rejection");
