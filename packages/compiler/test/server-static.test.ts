import { createHash } from "node:crypto";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { compile, compileStaticServer } from "../src/index.js";

const fileName = "packages/compiler/test/static-product.tsx";
const make = (source: string) => compileStaticServer({ fileName, routeId: "product", source });
const errors = (source: string) => make(source).diagnostics.filter(d => d.severity === "error");

describe("build-time literal-only SSR compiler target", () => {
  it("emits deterministic trusted Node renderer code and digest from actual bytes", () => {
    const source = "function Product(){ return <main><h1>ZaakiyJS</h1><p>Safe page</p></main>; }";
    const first = make(source);
    const second = make(source);
    expect(first.diagnostics.filter(d => d.severity === "error")).toEqual([]);
    expect(first.js).toEqual(second.js);
    expect(first.js).toHaveLength(1);
    const output = first.js[0]!.code;
    const emittedDigest = createHash("sha256").update(output).digest("hex");
    expect(emittedDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(first.js[0]?.fileName).toBe("packages/compiler/test/static-product.server.js");
    expect(output).not.toContain("@zaakiyjs/compiler");
    expect(output).not.toContain("eval(");
    expect(output).not.toContain("createElement(");
    const module = runInNewContext(output.replace(/\bexport /g, "") + "\n({ protocol, render })") as {
      protocol: string;
      render(context: unknown): { version: number; status: number; body: string;
        headers: Record<string, string>; cache: { scope: string } };
    };
    expect(module.protocol).toBe("zaakiy.render/1");
    const response = module.render({
      schema: "zaakiy.render/1",
      request: { signal: new AbortController().signal }
    });
    expect(response.status).toBe(200);
    expect(response.body).toBe("<main><h1>ZaakiyJS</h1><p>Safe page</p></main>");
    expect(response.cache.scope).toBe("no-store");
    expect(response.headers["content-type"]).toMatch(/text\/html/);
  });

  it("escapes literal text and quoted attributes against HTML and script injection", () => {
    const source = [
      "function Product(){ return (" ,
      '  <main><p title={"a\\\"&<tag>"}>{"<script>alert(1)</script> &"}</p></main>); }'
    ].join("\n");
    const result = make(source);
    expect(result.diagnostics.filter(d => d.severity === "error")).toEqual([]);
    expect(result.html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(result.html).toContain("&amp;");
    expect(result.html).toContain("a&quot;&amp;&lt;tag&gt;");
    expect(result.html).not.toContain("<script>");
  });

  it("retains only safe literal URLs and static boolean attributes", () => {
    const accepted = make(
      'function Page(){ return <main><a href="/docs">Docs</a><input disabled checked /></main>; }'
    );
    expect(accepted.diagnostics.filter(d => d.severity === "error")).toEqual([]);
    expect(accepted.html).toContain('href="/docs"');
    expect(accepted.html).toContain('disabled=""');
    expect(accepted.html).toContain('checked=""');
    for (const url of ["javascript:alert(1)", "//evil.test", "data:text/html,payload"]) {
      const result = make('function Page(){ return <a href="' + url + '">unsafe</a>; }');
      expect(result.js).toHaveLength(0);
      expect(result.diagnostics.some(d => d.severity === "error")).toBe(true);
    }
  });

  it("fails closed on dynamic state, event handlers, components and unsafe markup", () => {
    const variants = [
      'function Page(){ const name = "x"; return <p>{name}</p>; }',
      'function Page(){ return <button onClick={() => {}}>Click</button>; }',
      'function Card(){ return <p>Card</p>; } function Page(){ return <Card />; }',
      'function Page(){ return <script src="/safe.js" />; }',
      'function Page(){ return <div style="background:red">bad</div>; }'
    ];
    for (const source of variants) {
      expect(make(source).js).toHaveLength(0);
      expect(errors(source).length).toBeGreaterThan(0);
    }
  });

  it("does not change v1 native DOM compilation", () => {
    const source = "function Page(){ return <main><p>Existing DOM API</p></main>; }";
    const client = compile({ fileName, source });
    const server = make(source);
    expect(client.irVersion).toBe(1);
    expect(client.js).toHaveLength(1);
    expect(server.js).toHaveLength(1);
    expect(client.js[0]?.code).toContain("createElement");
    expect(server.js[0]?.code).not.toContain("createElement");
    const invalid = compileStaticServer({ fileName, source, routeId: "../unsafe" });
    expect(invalid.js).toHaveLength(0);
  });
});
