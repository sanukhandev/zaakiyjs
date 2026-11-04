import {signal} from "@zaakiyjs/core";

export function App() {
  const count = signal(0);

  return (
    <main class="mx-auto p-8">
      <h1>ZaakiyJS Counter</h1>
      <p>Compiler-first, fine-grained reactivity.</p>
      <button type="button" onClick={() => { count.value += 1; }}>
        Count: {count.value}
      </button>
    </main>
  );
}
