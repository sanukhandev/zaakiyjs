# ADR 0005 — Typed compiler-only TSX control-flow intrinsics

- **Status:** Accepted M1 native-element authoring subset; real compiled-app Chromium/Firefox/WebKit acceptance passed (24/24 scenarios). Extended grammar and release acceptance remain separate.
- **Date:** 2026-11-04
- **Ownership:** `@zaakiyjs/core` supplies typed function component contracts; `@zaakiyjs/compiler` owns syntactic recognition/lowering; `@zaakiyjs/dom/compiler` owns DOM regions.
- **IR:** Preserve schema v1 `ConditionalBlock` and `KeyedLoop`; no new IR node kinds or mandatory JSX renderer.

## Authoring

```tsx
import { Show, For } from "@zaakiyjs/core";
import { signal } from "@zaakiyjs/signals";

const open = signal(true);
const rows = signal([{ id: "a", name: "One" }]);

function App() {
  return <main>
    <Show when={open.value} fallback={<p>Closed</p>}>
      <p>Open</p>
    </Show>
    <ul>
      <For each={rows.value} by={row => row.id}>
        {row => <li>{row.name}</li>}
      </For>
    </ul>
  </main>;
}
```

**Explicit import required:** Only named `Show`/`For` imports from `@zaakiyjs/core` (including aliases) are special. Unrelated local components with those names are never rewritten; lexical shadows of core imports are also never treated as intrinsics. These functions throw if invoked outside the compiler, so an uncompiled JSX tree cannot silently execute a virtual DOM runtime.

**Show:** `when` is a required boolean JSX expression; one native element child is required. `fallback` is optional and must be a single native JSX element or `null`. A conditional region owns its branch scope, disposes the inactive branch before removal and does not reinitialize the active branch when the predicate stays unchanged.

**For:** `each` accepts a readonly array; `by` is a required inline arrow or stable named function reference returning a primitive `PropertyKey`; arbitrary calls and accessors are refused to avoid extra side-effectful selector evaluation. The single JSX child must be an arrow render function with one named item argument and a single native element result. Each keyed item has a scope-owned signal; same-key replacements update targeted text/properties without reinitializing the element, and DOM reorders reuse existing focused nodes. The DOM ABI validates duplicate keys before mutation. Event handlers read the current item signal.

**Fail closed:** JSX spreads, multiple sibling roots, destructured/async render callbacks, nested keyed loops, reactive keyed class/attributes, conditional children that directly contain another region, fragments and unsupported component children must produce deterministic compilation errors rather than silent JSX runtime fallbacks. Use a native element wrapper where necessary.

## Safety, tests and migration

No `innerHTML`, `eval`, `new Function`, runtime compiler or global Promise/timer patches are introduced. Component/region lifecycle and disposal follow [ADR 0004](0004-dom-region-abi.md); scheduler phases follow [ADR 0003](0003-signals-scheduler.md). TypeScript checks native JSX props and key selector types; source-level diagnostics reject unsupported shapes. The supported M1 syntax passed [24/24 actual browser cases](../../tests/browser/README.md) in Chromium, Firefox and WebKit, including keyboard access, mutation targeting, focus, cleanup, XSS text, and duplicate keys. This does not certify all accessibility guidelines or supported browser versions; SSR/hydration and advanced JSX grammar remain additional release gates.

The existing `IR_SCHEMA_VERSION=1` is retained; this is an additive compiler authoring feature, not a previously published API migration.
