# API and architecture reference (pinned snapshot)

Source: https://github.com/sanukhandev/zaakiyjs/tree/5fe0e1765bc802ea3f3eebb76a43bd585166c518. Read actual exports, source, package README and behavioral tests in the checkout before writing calls. Some historical package README status statements lag implementation; current exports/tests and commit-pinned certificate outrank roadmap prose.

| Package | Purpose / verified starting symbols | Reference path |
| --- | --- | --- |
| signals | signal, computed, effect, batch, untrack, flushSync | packages/signals/src/index.ts |
| core | createOwner, runWithOwner, onCleanup, onMount, mountOwner, disposeOwner, ownEffect, ownDisposable, createContext, provide, requireContext, Show, For, Slot | packages/core/src/index.ts |
| dom | mount, hydrate; compiler helpers in /compiler, not a JSX interpreter | packages/dom/README.md |
| compiler | compile, parseToIR, validateIR, optimizeIR; compileRegionServer for supported server regions | packages/compiler/src/index.ts; src/server-region.ts |
| styles | brand configuration and static utility CSS compilation | packages/styles/README.md |
| vite-plugin | zaakiyPlugin | packages/vite-plugin/README.md |
| cli | start --project, generate/g, doctor, analyze bundle | packages/cli/README.md |
| router | defineRoute, createRouter, createBrowserHistory, createBrowserRestoration, definePageAdapter | packages/router/README.md |
| forms | createForm, typed field and array handles | packages/forms/README.md |
| async | createResource, createTask, createResourceCache, composeSignals | packages/async/README.md |
| http, proxy | typed Fetch client / server-only proxy | packages/http/README.md; packages/proxy/README.md |
| ssr | server/build/node and client exports; /client/flat specialized hydration | packages/ssr/package.json; packages/ssr/README.md |
| seo, compat | public SEO contracts and declared browser compatibility | respective package README and exports |
| store, ui-primitives, ui, templates, motion, image, ads, analytics, consent | inspect exact available APIs and release contracts; no invented methods | respective package README and exports |

The source workspace has 24 packed-consumer-validated packages. AI, devtools and testing are planned package boundaries, not verified published runtime dependencies.

## Signals and ownership

~~~ts
import { signal, computed, effect } from "@zaakiyjs/signals";
import { createOwner, runWithOwner, ownEffect, disposeOwner } from "@zaakiyjs/core";

const owner = createOwner();
const count = signal(0);
const doubled = computed(() => count.value * 2);
runWithOwner(owner, () => {
  ownEffect(() => effect(() => { console.log(doubled.value); }));
});
disposeOwner(owner);
~~~

Signals are mutable through .value, computed is lazy/pure and readonly, effect executes initially and then schedules deduplicated updates. Effect return cleanup is for rerun/disposal. Use batch for grouped writes; flushSync for controlled tests/explicit synchronization, never inside a tracked computation or active scheduler drain. Do not destructure a .value snapshot and expect it to become reactive. Core does not export the signal value factory; import it from signals. Ownership is synchronous, explicit and hierarchical; do not assume async context tracking or automatic KeepAlive effect pausing.

## Compiler limitations and supported patterns

Use compiler fixture tests for exact supported grammar. Static native markup, typed primitive reactive text, approved native properties/events, safe conditionals, keyed native loops and selected component/slot paths are tested. Prefer a native host for dynamic regions and stable string/number keys. Some component-root/keyed/dynamic spreads, arbitrary prebuilt JSX values, unsafe attributes, unknown reactive calls and advanced composition are restricted. Never switch to a React runtime or suppress a fatal compiler diagnostic. Verify componentSlots configuration and IR v1/v2 contract before relying on slots. Do not make ABI/IR changes without a versioned ADR and compatibility evidence.

## SSR/hydration

compileRegionServer returns the verified supported plan and generated server JS; for eligible routes it also returns clientHydration and clientCapability. Bundle the emitted JS module and use its hydrateCompiledRegion(container, envelope, manifest, bindings) export with matching trusted build artifacts. Use hydrationScale large plus explicit hydrationMarkerFormat compact-v3 only when appropriate; itemDataMode snapshot means immutable plain row objects without getters or reactive proxy traps, updated by replacing keyed items. No caller-supplied explicit element-ID events in compact-v3. The compiler selects flat-v3 for restricted native scalar rows and supported surrounding structure; complex/legacy routes retain generic hydration. Use the existing API and format for tracked item data. Do not invoke hydrateFlatPage on arbitrary plans or generate executable code from remote content.

## Security and version policy

Never expose server-only imports, credentials or private SSR data in client assets. Native text APIs, safe URL policies and CSP are required. Use owner-scoped abortable async resources and server-side auth/idempotency. No browser Gemini, unsafe HTML injection, eval or new Function. Do not infer public npm availability from 0.0.0 source manifests or pack success. Read actual dependencies/exports and use independently versioned changesets for API changes.
