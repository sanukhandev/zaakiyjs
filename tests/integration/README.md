# Core/Signals/DOM integration verification

This branch is an isolated, **non-mergeable validation snapshot** assembled from:
- `feat/foundation-core`
- `feat/foundation-signals`
- `feat/foundation-dom`

No production branch was merged or modified to construct it. The lockfile here is regenerated using pnpm 10.20.0 to account for DOM's `jsdom` test dependency. The root M0 export guard was adjusted in this verification branch only to recognize the transition from contract-only to implemented packages.

Run `pnpm install --frozen-lockfile && pnpm lint && pnpm typecheck && pnpm test`. The test `core-signals-dom.test.ts` validates real owned signal-effect disposal, nested lifecycle mounts, targeted binding identity, safe listener cleanup and isolated provider roots.

Do not merge this stacked verification branch directly into `main`. Integrate the production PRs independently after their contracts, tests and dependency graph pass, then port the root guard and integration tests in a coordinated PR.
