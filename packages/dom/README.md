# @zaakiyjs/dom

Native DOM target and owner-scoped browser runtime for compiler-generated ZaakiyJS applications. This is **not** a JSX interpreter and does not use a virtual DOM, compiler AST, or tree reconciliation.

## Public browser modules

- `@zaakiyjs/dom`: `mount(compiledFactory, container)` initializes a fresh owner once; `dispose()` cleans up and removes only its mounted range.
- `@zaakiyjs/dom/compiler`: frozen v1 primitives `createElement`, `createText`, `setText`, `setProperty`, `setAttribute`, `bindText`, `bindProperty`, and `listen`.
- Additional browser helpers: `setClass`, `setStyle`, `bindAttribute`, `bindClass`, `bindStyle`, `bindRef`, `listenStable`, and `cloneStatic`.

`bind*` functions connect render-phase signal effects to core owner cleanup. A read tracks only signals accessed by that binding. `setText` updates `Text.data` only when changed. Immutable templates are constructed DOM nodes cloned with `cloneNode(true)`; HTML strings are never parsed.

## Hand-authored compiler ABI fixture

```ts
const count = signal(0);
const app = mount((owner) => {
  const button = createElement("button", "html");
  const text = createText("");
  button.append(text);
  bindText(owner, text, () => count.value);
  listen(owner, button, "click", () => { count.value += 1; });
  return button;
}, document.querySelector("#app")!);
app.dispose();
```

The example is generated-code style. M0's TSX is still typecheck-only. There is no JSX runtime fallback.

## Internal region machinery

`src/regions.ts` implements scoped conditional regions and keyed range moves. It is deliberately **not** a package export. Compiler ABI for loops, range marker shape, `<Show>` and `<For>` requires a coordinated ADR before release. Duplicate keys throw before DOM changes; matching keys retain their item owners and native nodes.

## Security

- Text is never injected as HTML.
- Dynamic inline event attributes and HTML sinks are forbidden.
- URL-bearing bindings are scheme-validated; `srcset` is rejected pending an approved URL-list policy.
- Arbitrary CSS URLs and legacy executable CSS functions are rejected.
- Static-clone helper accepts constructed DOM nodes only; no `innerHTML`, `eval`, or `new Function`.
- Standard native events and owner cleanup; no global async patches.

## Integration gate

**Draft / blocked:** M0 core and signals on `main` expose only types. This package requires the agreed owner and signal callable APIs. The repository M0 export-surface contract test will require coordinated retirement. DOM jsdom tests require a frozen lockfile refresh; compiler-produced fixtures and real-browser verification are pending.

No measured bundle size, memory, or performance claims are made before a reproducible build and CI pass.
