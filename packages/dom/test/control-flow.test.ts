// @vitest-environment jsdom
/** End-to-end TSX compiler -> real Signals/Core/DOM region ABI acceptance. */
import { afterEach, describe, expect, it } from "vitest";
import { compile } from "@zaakiyjs/compiler";
import { flushSync } from "@zaakiyjs/signals";
import { mount } from "../src/index.js";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

type Row = { id: string; label: string };
type Ref<T> = { value: T; observers?: ReadonlySet<unknown> };
interface FixtureModule {
  App: () => Node;
  visible: Ref<boolean>;
  rows: Ref<Row[]>;
  clicked: Ref<string>;
}
const folders: string[] = [];
afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
  document.body.replaceChildren();
});

async function appFixture(): Promise<FixtureModule> {
  const folder = mkdtempSync(join(process.cwd(), "packages", "dom", "test", ".intrinsics-"));
  folders.push(folder);
  const fileName = join(folder, "app.tsx");
  const source = [
    'import { Show, For } from "@zaakiyjs/core";',
    'import { signal } from "@zaakiyjs/signals";',
    'export const visible = signal(true);',
    'export const clicked = signal("");',
    'export const rows = signal([{id: "a", label: "Alpha"}, {id: "b", label: "Beta"}]);',
    'export function App() { return <main>',
    '  <Show when={visible.value} fallback={<p id="hidden">Hidden</p>}>',
    '    <button id="shown" onClick={() => clicked.value = "shown"}>Shown</button>',
    '  </Show>',
    '  <ol><For each={rows.value} by={item => item.id}>',
    '    {item => <li><input value={item.label} />',
    '      <span>{item.label}</span>',
    '      <button onClick={() => clicked.value = item.id}>select</button>',
    '    </li>}',
    '  </For></ol>',
    '</main>; }'
  ].join("\n");
  const result = compile({ fileName, source });
  expect(result.diagnostics.filter(d => d.severity === "error")).toEqual([]);
  expect(result.js).toHaveLength(1);
  const js = result.js[0]?.code;
  expect(js).toContain("bindConditionalRegion");
  expect(js).toContain("bindKeyedRegion");
  const generated = join(folder, "app.mjs");
  writeFileSync(generated, js!);
  return await import(pathToFileURL(generated).href) as FixtureModule;
}

describe("compiled Show and For with real DOM and signals", () => {
  it("replaces exclusive conditional branches and disposes detached listeners", async () => {
    const fixture = await appFixture();
    const host = document.createElement("div");
    document.body.append(host);
    const app = mount(() => fixture.App(), host);
    const shown = host.querySelector<HTMLButtonElement>("#shown");
    expect(shown?.textContent).toBe("Shown");
    shown?.click();
    expect(fixture.clicked.value).toBe("shown");

    fixture.visible.value = false;
    flushSync();
    expect(host.querySelector("#shown")).toBeNull();
    expect(host.querySelector("#hidden")?.textContent).toBe("Hidden");
    fixture.clicked.value = "";
    shown?.click();
    expect(fixture.clicked.value).toBe("");

    fixture.visible.value = true;
    flushSync();
    const replaced = host.querySelector("#shown");
    expect(replaced).not.toBe(shown);
    expect(host.querySelector("#hidden")).toBeNull();
    app.dispose();
    expect(host.childNodes).toHaveLength(0);
    expect(fixture.visible.observers?.size).toBe(0);
  });

  it("updates same-key items precisely, preserves focus and identity on reorder", async () => {
    const fixture = await appFixture();
    const host = document.createElement("div");
    document.body.append(host);
    const app = mount(() => fixture.App(), host);
    const original = [...host.querySelectorAll("li")];
    expect(original).toHaveLength(2);
    const firstInput = original[0]?.querySelector("input");
    const secondText = original[1]?.querySelector("span")?.firstChild;
    const firstText = original[0]?.querySelector("span")?.firstChild;
    expect(firstInput?.value).toBe("Alpha");

    const mutations: MutationRecord[] = [];
    const observer = new MutationObserver(records => mutations.push(...records));
    observer.observe(host, { subtree: true, characterData: true, childList: true, attributes: true });
    fixture.rows.value = [{id: "a", label: "Alpha2"}, {id: "b", label: "Beta"}];
    flushSync();
    await Promise.resolve();
    expect(host.querySelectorAll("li")[0]).toBe(original[0]);
    expect(firstInput?.value).toBe("Alpha2");
    expect(original[0]?.querySelector("span")?.firstChild).toBe(firstText);
    expect(original[1]?.querySelector("span")?.firstChild).toBe(secondText);
    expect(mutations.filter(m => m.target === secondText)).toHaveLength(0);
    expect(mutations.filter(m => m.type === "childList")).toHaveLength(0);
    observer.disconnect();

    firstInput?.focus();
    firstInput?.setSelectionRange(2, 4);
    fixture.rows.value = [{id: "b", label: "Beta"}, {id: "a", label: "Alpha2"}];
    flushSync();
    const reordered = [...host.querySelectorAll("li")];
    expect(reordered[0]).toBe(original[1]);
    expect(reordered[1]).toBe(original[0]);
    expect(document.activeElement).toBe(firstInput);
    expect(firstInput?.selectionStart).toBe(2);
    expect(firstInput?.selectionEnd).toBe(4);

    reordered[1]?.querySelector("button")?.click();
    expect(fixture.clicked.value).toBe("a");
    app.dispose();
    expect(fixture.rows.observers?.size).toBe(0);
  });

  it("rejects duplicate keys before modifying existing DOM", async () => {
    const fixture = await appFixture();
    const host = document.createElement("div");
    document.body.append(host);
    const app = mount(() => fixture.App(), host);
    const original = [...host.querySelectorAll("li")];
    fixture.rows.value = [{id: "a", label: "Bad"}, {id: "a", label: "Duplicate"}];
    expect(() => flushSync()).toThrow();
    expect([...host.querySelectorAll("li")]).toEqual(original);
    expect(original[0]?.querySelector("span")?.textContent).toBe("Alpha");
    app.dispose();
  });
});
