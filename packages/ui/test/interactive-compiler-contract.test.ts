import {describe, expect, it} from "vitest";
import {compile} from "@zaakiyjs/compiler";

describe("compiler IR v2 named overlay slots", () => {
  const source = [
    'import {Dialog, Popover} from "@zaakiyjs/ui";',
    'declare const overlays: import("@zaakiyjs/ui-primitives").OverlayManager;',
    'export function App() { return <main>',
    '  <Dialog id="detail" title="Details" description="Description" triggerLabel="Open"',
    '    overlays={overlays} body={<section><button type="button">Native child</button></section>} />',
    '  <Popover id="extra" triggerLabel="Options" overlays={overlays}',
    '    content={<button type="button">Actions</button>} />',
    '</main>; }'
  ].join("\n");

  it("compiles JSX-valued named props into native owned slot factories", () => {
    const result = compile({
      fileName: "packages/ui/test/interactive-owned-slots-v2.tsx",
      source, componentSlots: true
    });
    expect(result.diagnostics.filter(item => item.severity === "error")).toEqual([]);
    expect(result.irVersion).toBe(2);
    const code = result.js[0]?.code ?? "";
    expect(code).toContain("createOwnedNativeSlot");
    expect(code).toContain('"body": ');
    expect(code).toContain('"content": ');
    expect(code).not.toContain("jsx-runtime");
  });

  it("rejects named JSX child props in legacy IR v1", () => {
    const result = compile({
      fileName: "packages/ui/test/interactive-owned-slots-ir1.tsx", source
    });
    expect(result.diagnostics.some(item => item.severity === "error")).toBe(true);
    expect(result.js).toHaveLength(0);
  });
});
