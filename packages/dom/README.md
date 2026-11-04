# @zaakiyjs/dom

Native DOM target and owner-scoped browser runtime for compiler-generated ZaakiyJS applications. This is **not** a JSX interpreter and does not use a virtual DOM, compiler AST, or tree reconciliation.

## Public browser modules

- `@zaakiyjs/dom`: `mount(compiledFactory, container)` initializes a fresh owner once; `dispose()` cleans up and removes only its mounted range.
- `@zaakiyjs/dom/compiler`: frozen v1 primitives `createElement`, `createText`, `setText`, `setProperty`, `setAttribute`, `bindText`, `bindProperty`, and `listen`.
- Additional browser helpers: `setClass`, `setStyle`, `bindAttribute`, `bindClass`, `bindStyle`, `bindRef`, `listenStable`, and `cloneStatic`.

`bind*` functions connect render-phase signal effects to core owner cleanup. A read tracks only signals accessed by that binding. `setText` updates `Text.data` only when changed. Reactive boolean or nullish JSX children normalize to empty text, matching the compiler's nonreactive lowering. Immutable templates are constructed DOM nodes cloned with `cloneNode(true)`; HTML strings are never parsed.

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

**Draft / blocked:** M0 core and signals on `main` expose only types. This package requires the agreed owner and signal callable APIs. The repository M0 export-surface contract test will require coordinated retirement. The frozen lockfile includes the jsdom test dependency. Artifact and npm-pack checks run in CI. Native Chromium smoke runs when a Chrome binary is present; the compiler-generated Counter fixture runs when `@zaakiyjs/compiler` is implemented. Firefox/WebKit Playwright coverage remains a separate integration gate.

Production bundle size and memory-leak benchmarks require dedicated reproducible profiling; the artifact and Chromium smoke tests report directly measured byte counts but must not be represented as a full production-bundle benchmark.

## Validation

- `pnpm --filter @zaakiyjs/dom build` and `pnpm --filter @zaakiyjs/dom test` require implemented compatible `core`/`signals` packages.
- Package tests include `MutationObserver` assertions, ownership cleanup, keyed range identity, URL and style sink defenses, native Chromium smoke, and npm pack/declaration verification.
- The Chromium smoke bundles a **test harness plus core/signals**; its logged gzip bytes are not the isolated DOM package size. Artifact tests also report raw and per-module gzip bytes for generated DOM JavaScript.
- The real-browser smoke uses an installed Chromium binary; when none exists, Vitest explicitly marks it skipped. Full Chromium/Firefox/WebKit matrix remains an integration gate.
