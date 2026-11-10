import { describe, expect, it } from "vitest";
import { compileDataServer } from "../src/index.js";

const fileName = "packages/compiler/test/data-product.tsx";
const source = [
  "function Page(props: { customer: { name: string }; order: number }) {",
  'return <main class="product"><h1>{props.customer.name}</h1><p>{props.order}</p></main>;',
  "}"
].join("\n");
const build = (tsx: string = source) =>
  compileDataServer({ fileName, routeId: "product", source: tsx });

function run(code: string, data: string, route = "product"): unknown {
  // This test executes only reviewed emitted JavaScript; the actual HTTP
  // integration test imports the emitted module through Node's ESM loader.
  const vmSource = code.replace(/\bexport /g, "") + "\nrender({" +
    'schema:"zaakiy.render/1",route:{id:' + JSON.stringify(route) + '},' +
    'request:{signal:{aborted:false}},loaderData:' + data + "})";
  // vm import deliberately scoped here; no generated server module imports it.
  return vmSource;
}

describe("read-only loaderData TSX server target", () => {
  it("emits deterministic, expression-free standalone modules with bounded property paths", () => {
    const result = build();
    expect(result.diagnostics.filter(d => d.severity === "error")).toEqual([]);
    expect(result.js).toHaveLength(1);
    expect(result.dynamicPaths).toEqual([["customer", "name"], ["order"]]);
    expect(result.js[0]?.code).toContain('export const protocol = "zaakiy.render/1"');
    expect(result.js[0]?.code).toContain('["customer","name"]');
    expect(result.js[0]?.code).not.toContain("props.customer.name");
    expect(result.js[0]?.code).not.toContain("@zaakiyjs/compiler");
    expect(result.js[0]?.code).not.toContain("eval(");
    expect(build().js).toEqual(result.js);
  });

  it("does not execute arbitrary calls, JSX components, event handlers or reactive signals", () => {
    const invalid = [
      'function Page(props: {name:string}) {return <p>{props.name.toUpperCase()}</p>;}',
      'function Page(props: {name:string}) {return <p>{props["name"]}</p>;}',
      'function Page(props: {name:string}) {return <p>{props.name + "!"}</p>;}',
      'function Page(props: {name:string}) {return <p>{props.__proto__}</p>;}',
      'function Card(){return <p>card</p>;} function Page(){return <Card />;}',
      'function Page(){return <button onClick={() => {}}>button</button>;}',
      'function Page(props:{name:string}){return <a href={props.name}>Link</a>;}',
      'function Page(){return <div style="color:red">bad</div>;}',
      'function Page(){return <script>alert(1)</script>;}',
      'function Page(){return <div>{Date.now()}</div>;}'
    ];
    for (const tsx of invalid) {
      const result = build(tsx);
      expect(result.js, tsx).toHaveLength(0);
      expect(result.diagnostics.some(d => d.severity === "error"), tsx).toBe(true);
    }
  });

  it("rejects malformed routes and huge generated input", () => {
    expect(compileDataServer({ fileName, routeId: "../private", source }).js).toHaveLength(0);
    expect(compileDataServer({ fileName, routeId: "product", source: source + " ".repeat(256 * 1024) }).js).toHaveLength(0);
  });

  it("generates explicit route and request validation and plain-property reads", () => {
    const result = build();
    expect(result.diagnostics.filter(d => d.severity === "error")).toEqual([]);
    const code = result.js[0]!.code;
    expect(code).toContain('context.route.id !== "product"');
    expect(code).toContain("Object.getOwnPropertyDescriptor(object, key)");
    expect(code).toContain('!Object.hasOwn(descriptor, "value")');
    expect(code).toContain('cache: { scope: "no-store"');
    // The helper is for test instrumentation only; never run caller TSX.
    expect(run(code, '{"customer":{"name":"Ada"},"order":1}')).toContain('loaderData:{"customer"');
  });
});
