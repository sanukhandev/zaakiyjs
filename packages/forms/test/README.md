# Forms verification

`form.test.ts` contains executable Vitest unit and lifecycle tests; it requires the real Core and Signals packages in the pnpm workspace.

`types.compile.ts` is intentionally **compile-only**. It contains `@ts-expect-error` negative API checks that must not execute in Vitest. The package `typecheck` script includes it through `tsconfig.types.json`.

Run the package gates with:

```sh
pnpm --filter @zaakiyjs/forms lint
pnpm --filter @zaakiyjs/forms typecheck
pnpm --filter @zaakiyjs/forms build
pnpm --filter @zaakiyjs/forms test
```

Run repository-wide `pnpm ci` and the Chromium/Firefox/WebKit acceptance workflows before release. A frozen workspace install is required in CI; keep the forms importer in `pnpm-lock.yaml` synchronized.

When Forms is integrated after independently developed workspace packages (such as Store, Compat, or Async), preserve every existing `pnpm-lock.yaml` importer and the workspace validator's existing dependency boundaries. Verify that `@zaakiyjs/forms` is included in both the validator allowlist and its browser-runtime package set; Forms must depend only on Core and Signals.
