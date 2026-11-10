import { For, Show, onCleanup } from "@zaakiyjs/core";
import { computed, flushSync, signal } from "@zaakiyjs/signals";

type Row = { readonly id: string; readonly label: string };
type Group = { readonly id: string; readonly name: string; readonly children: readonly Row[] };

export const fixture = {
  counter: signal(0),
  visible: signal(true),
  activeClicks: signal(0),
  selected: signal("-"),
  rows: signal<readonly Row[]>([
    { id: "a", label: "Alpha" },
    { id: "b", label: "Beta" }
  ]),
  groups: signal<readonly Group[]>([
    { id: "g1", name: "One", children: [{ id: "c1", label: "First" }] },
    { id: "g2", name: "Two", children: [{ id: "c2", label: "Second" }] }
  ]),
  duplicateError: signal(""),
  lifecycle: { setups: 0, disposals: 0 },
  refEvents: { root: [] as string[], conditional: [] as string[] }
};

/** A component root receives a stable getter, never a stale keyed-item snapshot. */
function LiveGroup(props: { readonly live: () => Group }) {
  const name = computed(() => props.live().name);
  return <h3 class="live-group">{name.value}</h3>;
}

/** Compiled by the production Vite plugin, never rendered by a test-only JSX interpreter. */
export function App() {
  fixture.lifecycle.setups += 1;
  onCleanup(() => { fixture.lifecycle.disposals += 1; });
  return (
    <main>
      <h1>ZaakiyJS M1 browser acceptance</h1>
      <div id="variant-state"
        class={fixture.visible.value ? "status-pill is-visible" : "status-pill is-hidden"}
        aria-label={fixture.visible.value ? "Visible state" : "Hidden state"}
        data-state={fixture.visible.value ? "visible" : "hidden"}>Variant state</div>
      <button id="root-ref" type="button" ref={node => {
        fixture.refEvents.root.push(node === null ? "cleared" : node.isConnected ? "connected" : "detached");
      }}>Ref callback</button>
      <label htmlFor="email">Email address</label>
      <input id="email" type="email" />
      <button id="counter" type="button" onClick={() => { fixture.counter.value++; }}>
        Count: {fixture.counter.value}
      </button>
      <button id="toggle" type="button" onClick={() => {
        fixture.visible.value = !fixture.visible.value;
      }}>Toggle</button>
      <Show when={fixture.visible.value} fallback={<p id="hidden">Hidden</p>}>
        <button id="shown" type="button" ref={node => {
          fixture.refEvents.conditional.push(node === null ? "cleared" : node.isConnected ? "connected" : "detached");
        }} onClick={() => { fixture.activeClicks.value++; }}>
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
      <button id="group-rename" type="button" onClick={() => {
        fixture.groups.value = fixture.groups.value.map(group => group.id === "g1"
          ? { ...group, name: "One2", children: [{ id: "c1", label: "First2" }] } : group);
      }}>Rename nested</button>
      <button id="group-reorder" type="button" onClick={() => {
        fixture.groups.value = [...fixture.groups.value].reverse();
      }}>Reorder nested</button>
      <button id="group-remove" type="button" onClick={() => {
        fixture.groups.value = fixture.groups.value.filter(group => group.id !== "g1");
      }}>Remove nested</button>
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
      <section id="advanced">
        <Show when={fixture.visible.value} fallback={<><i id="fallback-a">A</i><i id="fallback-b">B</i></>}>
          <p id="advanced-a">One</p><p id="advanced-b">Two</p>
        </Show>
        <div id="groups">
          <For each={fixture.groups.value} by={group => group.id}>
            {group => <>
              <h2>{group.name}</h2>
              <ul><For each={group.children} by={child => child.id}>
                {child => <li><strong>{group.name}:{child.label}</strong>
                  <button type="button" onClick={() => { fixture.selected.value = child.label; }}>Choose</button>
                </li>}
              </For></ul>
            </>}
          </For>
        </div>
        <div id="component-groups">
          <For each={fixture.groups.value} by={group => group.id}>
            {group => <LiveGroup live={() => group} />}
          </For>
        </div>
      </section>
    </main>
  );
}
