import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { compile } from "@zaakiyjs/compiler";

describe("current TSX compiler integration boundary", () => {
  it("compiles the multi-component showcase using the actual Zaakiy compiler", () => {
    const fileName = fileURLToPath(new URL("./fixtures/showcase.tsx", import.meta.url));
    const source = readFileSync(fileName, "utf8");
    const result = compile({ fileName, source });
    expect(result.diagnostics.filter(x => x.severity === "error")).toEqual([]);
    expect(result.js).toHaveLength(1);
    expect(result.js[0]?.code).toContain("initializeOwnedComponent");
  });

  it("lowers an explicit-prop UI component call without a JSX runtime", () => {
    const source = [
      'import type { JSX } from "@zaakiyjs/core/jsx-runtime";',
      'declare function Button(props: { label: string }): JSX.Element;',
      'function App() { return <main><Button label="Save" /></main>; }'
    ].join("\n");
    const result = compile({ fileName: "packages/ui/test/explicit-props.tsx", source });
    expect(result.diagnostics.filter(x => x.severity === "error")).toEqual([]);
    expect(result.js[0]?.code).toContain("initializeOwnedComponent");
    expect(result.js[0]?.code).not.toContain("jsx-runtime");
  });

  it("compiles native UI layout/Card JSX child slots with IR v2", () => {
    const source = [
      'import { Stack, Card, Button } from "@zaakiyjs/ui";',
      "function App() { return <main>",
      '  <Stack gap="sm"><Button label="Save" /></Stack>',
      '  <Card title="Notice"><strong>Compiled child</strong></Card>',
      "</main>; }"
    ].join("\n");
    const result = compile({
      fileName: "packages/ui/test/native-children-v2.tsx", source, componentSlots: true
    });
    expect(result.diagnostics.filter(x => x.severity === "error")).toEqual([]);
    expect(result.irVersion).toBe(2);
    expect(result.js[0]?.code).toContain("createOwnedNativeSlot");
    expect(result.js[0]?.code).toContain('"children": ');
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
