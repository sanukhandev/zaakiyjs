// @vitest-environment jsdom
/** Real compiler -> @zaakiyjs/dom/compiler ABI conformance. No ABI mocks. */
import { afterEach, describe, expect, it } from "vitest";
import { compile } from "@zaakiyjs/compiler";
import { flushSync } from "@zaakiyjs/signals";
import { mount } from "../src/index.js";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

afterEach(() => document.body.replaceChildren());

async function compiledModule(source: string): Promise<{
  App: () => Node;
  visible: { value: boolean };
  entries: { value: Array<{ id: string; name: string }> };
}> {
  const folder = mkdtempSync(join(process.cwd(), "packages/dom/test/.regions-"));
  try {
    const fileName = join(folder, "app.tsx");
    const result = compile({ fileName, source });
    expect(result.diagnostics.filter(d => d.severity === "error")).toEqual([]);
    expect(result.js).toHaveLength(1);
    const code = result.js[0]!.code;
    expect(code).toContain("@zaakiyjs/dom/compiler");
    const dest = join(folder, "app.mjs");
    writeFileSync(dest, code);
    // Dynamic module bytes are loaded before the temporary directory is removed.
    return await import(pathToFileURL(dest).href) as {
      App: () => Node;
      visible: { value: boolean };
      entries: { value: Array<{ id: string; name: string }> };
    };
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

describe("real compiled region ABI", () => {
  it("switches owner-scoped conditional branches and preserves keyed item DOM identity", async () => {
    const module = await compiledModule([
      'import { signal } from "@zaakiyjs/signals";',
      'export const visible = signal(true);',
      'export const entries = signal([{ id: "a", name: "Alpha" }, { id: "b", name: "Beta" }]);',
      "export function App() {",
      "return <section><p>{visible.value ? <strong>yes</strong> : <em>no</em>}</p>",
      "<ul>{entries.value.map(item => <li key={item.id}>{item.name}</li>)}</ul></section>;",
      "}"
    ].join("\n"));
    const host = document.createElement("div");
    document.body.append(host);
    const app = mount(() => module.App(), host);
    const entriesBefore = [...host.querySelectorAll("li")];
    expect(entriesBefore.map(n => n.textContent)).toEqual(["Alpha", "Beta"]);
    expect(host.querySelector("strong")?.textContent).toBe("yes");

    module.visible.value = false;
    flushSync();
    expect(host.querySelector("strong")).toBeNull();
    expect(host.querySelector("em")?.textContent).toBe("no");

    module.entries.value = [
      { id: "b", name: "Beta updated" },
      { id: "a", name: "Alpha updated" }
    ];
    flushSync();
    const entriesAfter = [...host.querySelectorAll("li")];
    expect(entriesAfter[0]).toBe(entriesBefore[1]);
    expect(entriesAfter[1]).toBe(entriesBefore[0]);
    expect(entriesAfter.map(n => n.textContent)).toEqual(["Beta updated", "Alpha updated"]);

    expect(() => {
      module.entries.value = [{ id: "a", name: "one" }, { id: "a", name: "two" }];
      flushSync();
    }).toThrow(/Duplicate key/);
    expect([...host.querySelectorAll("li")]).toEqual(entriesAfter);

    app.dispose();
    expect(host.childNodes).toHaveLength(0);
    module.visible.value = true;
    // All owned subscriptions must have been removed at this point.
    flushSync();
    expect(host.childNodes).toHaveLength(0);
  });

  it("reorders keyed native inputs without losing focus, selection or user text", async () => {
    const module = await compiledModule([
      'import { signal } from "@zaakiyjs/signals";',
      'export const visible = signal(true);',
      'export const entries = signal([{ id: "a", name: "A" }, { id: "b", name: "B" }]);',
      "export function App() {",
      "return <section>{entries.value.map(item => <input key={item.id} value={item.name} />)}</section>;",
      "}"
    ].join("\n"));
    const host = document.createElement("div");
    document.body.append(host);
    const app = mount(() => module.App(), host);
    const original = host.querySelectorAll("input")[1]!;
    original.value = "user edited";
    original.focus();
    original.setSelectionRange(3, 3);
    module.entries.value = [{ id: "b", name: "B" }, { id: "a", name: "A" }];
    flushSync();
    expect(host.querySelector("input")).toBe(original);
    expect(original.value).toBe("user edited");
    expect(document.activeElement).toBe(original);
    expect(original.selectionStart).toBe(3);
    app.dispose();
  });
});
