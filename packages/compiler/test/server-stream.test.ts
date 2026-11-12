import { describe, expect, it } from "vitest";
import { compileDataServer } from "../src/index.js";

const fileName = "packages/compiler/test/streamed-product.tsx";
const source = [
  "function Page(props: { customer: { name: string }; order: number }) {",
  'return <main class="product"><h1>{props.customer.name}</h1><p>{props.order}</p></main>;',
  "}"
].join("\n");
const request = { fileName, routeId: "product", source };
type Context = {
  schema: "zaakiy.render/1";
  route: { id: string };
  request: { signal: AbortSignal };
  loaderData: unknown;
};
type Response = { status: number; body: string | AsyncIterable<Uint8Array> };
type Generated = { render: (context: Context) => Response };
async function load(code: string): Promise<Generated> {
  const url = "data:text/javascript;base64," + Buffer.from(code).toString("base64");
  return await import(/* @vite-ignore */ url) as Generated;
}
const context = (data: unknown, signal = new AbortController().signal): Context => ({
  schema: "zaakiy.render/1", route: { id: "product" },
  request: { signal }, loaderData: data
});
async function text(body: string | AsyncIterable<Uint8Array>): Promise<string> {
  if (typeof body === "string") return body;
  const parts: Uint8Array[] = [];
  for await (const bytes of body) parts.push(bytes);
  const decoder = new TextDecoder();
  return parts.map((chunk, index) => decoder.decode(chunk, { stream: index < parts.length - 1 })).join("");
}

describe("E6 — compiler-generated streaming HTML", () => {
  it("preserves byte-identical default compilation and read-only escaped HTML", async () => {
    const baseline = compileDataServer(request);
    const disabled = compileDataServer({ ...request, streaming: false });
    const streamed = compileDataServer({ ...request, streaming: true });
    expect(baseline.js).toEqual(disabled.js);
    expect(streamed.diagnostics.filter(d => d.severity === "error")).toEqual([]);
    expect(streamed.dynamicPaths).toEqual(baseline.dynamicPaths);
    expect(streamed.js).toHaveLength(1);
    expect(streamed.js[0]!.code).not.toContain("eval(");
    expect(streamed.js[0]!.code).not.toContain("props.customer.name");
    const classicModule = await load(baseline.js[0]!.code);
    const streamModule = await load(streamed.js[0]!.code);
    const input = { customer: { name: '<script>alert("x")</script> 🛡️' }, order: 42 };
    const ordinary = classicModule.render(context(input));
    const streaming = streamModule.render(context(input));
    expect(streaming.status).toBe(200);
    expect(typeof streaming.body).not.toBe("string");
    const rendered = await text(streaming.body);
    expect(rendered).toBe(await text(ordinary.body));
    expect(rendered).toContain("&lt;script&gt;");
    expect(rendered).not.toContain("<script>");
    expect(rendered).toContain("🛡️");
  });

  it("respects abort before and during pull without evaluating user functions", async () => {
    const streamed = await load(compileDataServer({ ...request, streaming: true }).js[0]!.code);
    const already = new AbortController();
    already.abort(new Error("cancelled"));
    expect(() => streamed.render(context({}, already.signal))).toThrow("cancelled");

    const controller = new AbortController();
    const huge = "x".repeat(20_000);
    const output = streamed.render(context({ customer: { name: huge }, order: 2 }, controller.signal));
    if (typeof output.body === "string") throw new Error("Expected byte stream");
    const iterator = output.body[Symbol.asyncIterator]();
    const first = await iterator.next();
    expect(first.done).toBe(false);
    expect(first.value?.length).toBeGreaterThan(16_000);
    controller.abort(new Error("stream cancelled"));
    await expect(iterator.next()).rejects.toThrow("stream cancelled");

    const unsafe = Object.defineProperty({ order: 1 }, "customer", {
      enumerable: true,
      get() { throw new Error("getter must not be called"); }
    });
    const result = streamed.render(context(unsafe));
    if (typeof result.body === "string") throw new Error("Expected byte stream");
    await expect(text(result.body)).rejects.toThrow("getters are forbidden");
  });

  it("enforces bounded data values and emits a cumulative output guard", async () => {
    const output = compileDataServer({ ...request, streaming: true });
    expect(output.diagnostics.filter(d => d.severity === "error")).toEqual([]);
    expect(output.js[0]!.code).toContain("total > 1048576");
    const generated = await load(output.js[0]!.code);
    const response = generated.render(context({
      customer: { name: "q".repeat(65_537) }, order: 1
    }));
    await expect(text(response.body)).rejects.toThrow("text limit");
  });
});