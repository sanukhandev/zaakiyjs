import {For, Show} from "@zaakiyjs/core";
import {flushSync, signal} from "@zaakiyjs/signals";

interface Row { readonly id: number; readonly label: string }
const counter = signal(0);
const visible = signal(true);
const rows = signal<readonly Row[]>(Array.from({length: 1000}, (_, id) => ({id, label: "Row " + id})));

export function runBenchmark(operation: string): void {
  if (operation === "counter") counter.value += 1;
  else if (operation === "rename") rows.value = rows.value.map(row =>
    row.id === 500 ? {...row, label: row.label === "Row 500" ? "Renamed 500" : "Row 500"} : row);
  else if (operation === "reverse") rows.value = [...rows.value].reverse();
  else if (operation === "toggle") visible.value = !visible.value;
  else if (operation === "swap") {
    const prev = rows.value;
    rows.value = [prev[prev.length - 1]!, ...prev.slice(1, -1), prev[0]!];
  }
  else if (operation === "rotate") {
    const prev = rows.value;
    rows.value = [prev[prev.length - 1]!, ...prev.slice(0, -1)];
  }
  else if (operation === "append") rows.value = rows.value.some(row => row.id === 1000)
    ? rows.value.filter(row => row.id !== 1000)
    : [...rows.value, {id: 1000, label: "Row 1000"}];
  else if (operation === "prepend") rows.value = rows.value.some(row => row.id === -1)
    ? rows.value.filter(row => row.id !== -1)
    : [{id: -1, label: "Row -1"}, ...rows.value];
  else if (operation === "removeMiddle") rows.value = rows.value.some(row => row.id === 500)
    ? rows.value.filter(row => row.id !== 500)
    : [...rows.value, {id: 500, label: "Row 500"}];
  else throw new Error("Unknown benchmark operation");
  flushSync();
}
export function App() {
  return <main id="benchmark-root">
    <h1>Framework production benchmark</h1>
    <output id="counter">{counter.value}</output>
    <section id="visibility">
      <Show when={visible.value} fallback={<p id="hidden">Hidden</p>}>
        <p id="shown">Visible</p>
      </Show>
    </section>
    <ul id="rows"><For each={rows.value} by={row => row.id}>
      {row => <li><span>{row.id}::{row.label}</span></li>}
    </For></ul>
  </main>;
}