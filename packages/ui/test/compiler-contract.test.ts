import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { compile } from "@zaakiyjs/compiler";

describe("current TSX compiler integration boundary", () => {
  it("compiles the multi-component showcase using the actual Zaakiy compiler", () => {
    const source = readFileSync(new URL("./fixtures/showcase.tsx", import.meta.url), "utf8");
    const result = compile({ fileName: "showcase.tsx", source });
    expect(result.diagnostics.filter(x => x.severity === "error")).toEqual([]);
    expect(result.js).toHaveLength(1);
    expect(result.js[0]?.code).toContain("initializeOwnedComponent");
  });

  it("lowers an explicit-prop UI component call without a JSX runtime", () => {
    const source = [
      'declare function Button(props: { label: string }): JSX.Element;',
      'function App() { return <main><Button label="Save" /></main>; }'
    ].join("\n");
    const result = compile({ fileName: "showcase.tsx", source });
    expect(result.diagnostics.filter(x => x.severity === "error")).toEqual([]);
    expect(result.js[0]?.code).toContain("initializeOwnedComponent");
    expect(result.js[0]?.code).not.toContain("jsx-runtime");
  });

  it("fails closed on component children until the compiler owns their semantics", () => {
    const result = compile({
      fileName: "unsupported-children.tsx",
      source: 'function App() { return <Card><span>Hello</span></Card>; }'
    });
    expect(result.diagnostics.some(x => x.code === "ZC2102")).toBe(true);
    expect(result.js).toHaveLength(0);
  });

  it("fails closed on JSX spread attributes", () => {
    const result = compile({
      fileName: "unsupported-spreads.tsx",
      source: 'function App() { const props = { label: "Save" }; return <Button {...props} />; }'
    });
    expect(result.diagnostics.some(x => x.code === "ZC1002")).toBe(true);
    expect(result.js).toHaveLength(0);
  });
});
