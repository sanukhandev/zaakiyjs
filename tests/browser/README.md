# ZaakiyJS M1 three-browser acceptance

This is a **production-build browser test**, not an in-memory TSX renderer.

- `fixture/App.tsx` is substituted into a real CLI-generated TypeScript application.
- `fixture/main.tsx` mounts that component using the public `@zaakiyjs/dom` API and exposes fixture-only lifecycle assertions.
- GitHub Actions builds the application with the first-party Vite plugin and runs pinned Python Playwright against the production preview in **Chromium, Firefox and WebKit**.
- The runner tests Counter keyboard behavior, conditional branch ownership, stable keyed identity, targeted DOM mutation records, focus/selection preservation, insertion/removal, HTML-text injection handling, duplicate keys and disposal after repeated updates.
- Every browser/test combination runs. One failed case makes the workflow fail; no engine is silently skipped.
- Browser executables are installed from the exact pinned Playwright release. Release 1.64.1 is pinned in the CI workflow; updates require a reviewed version change and green full-matrix execution.

Run from the repo checkout using a generated `apps/browser-app` with the fixture files copied over the generated `src/App.tsx`/`src/main.tsx`:

```sh
python3 -m pip install playwright==1.64.1
python3 -m playwright install --with-deps chromium firefox webkit
pnpm --dir apps/browser-app build
pnpm --dir apps/browser-app exec vite preview --host 127.0.0.1 --port 4188 --strictPort
# In another shell:
python3 tests/browser/m1_acceptance.py --base-url http://127.0.0.1:4188
```

**Scope:** This verifies the M1 **supported native-element** `<Show>`/`<For>` subset and browser-level cleanup. It does not claim multi-root templates, nested loops, SSR, hydration, general-purpose JSX fragments, or npm publication.

The advanced extension adds three browser cases per engine: multi-root conditional branches, fragment-backed nested keyed lists and live-getter component-root keyed rows. With the extension enabled the matrix runs **17 cases × 3 engines = 51** and retains the original eight cases.

The matrix also verifies compiler-generated native `htmlFor` → `for` lowering: accessible textbox naming, label-click keyboard focus, and owner-scoped teardown in all three engines (issue #48).
\nThe connected native JSX ref extension is opt-in: callbacks receive connected DOM nodes after mount, remain stable across keyed reorders, and receive null exactly once on owner disposal. It is tested in the browser matrix alongside the unchanged eager `bindRef` API.\n
The finite dynamic-class gate extracts every literal branch into CSS tokens. Reactive classes and non-URL attributes use owner-scoped native bindings; non-enumerable class names and reactive URL sinks remain rejected.

The optional exit-aware native element region is also exercised in the three-browser matrix: pending exit retention, re-entry identity reuse, stale completion immunity, and synchronous parent-disposal abort. These tests do not imply compiler-generated keyed/fragment exits are supported.

The native slot primitive is tested in each browser for portal-host placement, one-shot factory execution, exact sibling-preserving cleanup, and owner-scoped mount/disposal. This does not imply JSX component children are compiled automatically.

The opt-in `componentSlots: true` compiler IR v2 path is exercised in real generated Vite output: `<SlotPanel><button>...</button><span>...</span></SlotPanel>` lowers to an owner-scoped native child factory, `{props.children}` mounts into a native outlet, and focus/identity survive unrelated keyed reorders. Default IR v1 remains unchanged. Named slots and arbitrary JSX-in-props are still unsupported.
