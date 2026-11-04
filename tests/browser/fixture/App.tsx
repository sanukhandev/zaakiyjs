import { For, Show, onCleanup } from "@zaakiyjs/core";
import { flushSync, signal } from "@zaakiyjs/signals";

type Row = { readonly id: string; readonly label: string };

export const fixture = {
  counter: signal(0),
  visible: signal(true),
  activeClicks: signal(0),
  selected: signal("-"),
  rows: signal<readonly Row[]>([
    { id: "a", label: "Alpha" },
    { id: "b", label: "Beta" }
  ]),
  duplicateError: signal(""),
  lifecycle: { setups: 0, disposals: 0 }
};

/** Compiled by the production Vite plugin, never rendered by a test-only JSX interpreter. */
export function App() {
  fixture.lifecycle.setups += 1;
  onCleanup(() => { fixture.lifecycle.disposals += 1; });
  return (
    <main>
      <h1>ZaakiyJS M1 browser acceptance</h1>
      <button id="counter" type="button" onClick={() => { fixture.counter.value++; }}>
        Count: {fixture.counter.value}
      </button>
      <button id="toggle" type="button" onClick={() => {
        fixture.visible.value = !fixture.visible.value;
      }}>Toggle</button>
      <Show when={fixture.visible.value} fallback={<p id="hidden">Hidden</p>}>
        <button id="shown" type="button" onClick={() => { fixture.activeClicks.value++; }}>
          Shown
        </button>
      </Show>
      <output id="active-clicks">{fixture.activeClicks.value}</output>

      <button id="rename" type="button" onClick={() => {
        fixture.rows.value = fixture.rows.value.map(row =>
          row.id === "a" ? { id: "a", label: "Alpha2" } : row);
      }}>Rename</button>
      <button id="reorder" type="button" onClick={() => {
        fixture.rows.value = [...fixture.rows.value].reverse();
      }}>Reorder</button>
      <button id="remove" type="button" onClick={() => {
        fixture.rows.value = fixture.rows.value.filter(row => row.id !== "a");
      }}>Remove</button>
      <button id="append" type="button" onClick={() => {
        fixture.rows.value = [...fixture.rows.value, { id: "c", label: "Gamma" }];
      }}>Append</button>
      <button id="inject" type="button" onClick={() => {
        fixture.rows.value = fixture.rows.value.map(row =>
          row.id === "a" ? { id: "a", label: "<img src=x onerror=alert(1)>" } : row);
      }}>Inject</button>
      <button id="duplicate" type="button" onClick={() => {
        fixture.rows.value = [{ id: "a", label: "Bad" }, { id: "a", label: "Duplicate" }];
        try {
          flushSync();
        } catch {
          fixture.duplicateError.value = "rejected";
        }
      }}>Duplicate</button>
      <output id="duplicate-error">{fixture.duplicateError.value}</output>
      <output id="selected">{fixture.selected.value}</output>

      <ol id="rows">
        <For each={fixture.rows.value} by={row => row.id}>
          {row => <li>
            <input aria-label="Row label" value={row.label} />
            <span>{row.label}</span>
            <button type="button" onClick={() => { fixture.selected.value = row.label; }}>Select</button>
          </li>}
        </For>
      </ol>
    </main>
  );
}
