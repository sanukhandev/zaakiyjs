# Workspace inventory and dependency baseline

Run `node scripts/ci/workspace-inventory.mjs > workspace-inventory.json` to capture a deterministic package/export/dependency snapshot. The command exits nonzero when a package lacks required scripts, exports or a valid manifest, a workspace dependency cannot be resolved, or a dependency cycle is detected.

Run `node --test scripts/ci/workspace-inventory.test.mjs` to exercise the inventory validator with isolated fixtures.

This is a **structural gate**, not a complete API/ABI compatibility test or production certification. Preserve the JSON from the baseline and candidate commits for review; do not assert compatibility solely from equal export-path names. The remaining compatibility gates must inspect declaration signatures, runtime behavior, IR/DOM fixtures, and downstream consumers.

## Post-build package export validation

After `pnpm build`, run `node --test scripts/ci/package-exports.test.mjs` and `node scripts/ci/package-exports.mjs`. This gate checks every package's declared export conditions, type entrypoints, and CLI bins against actual files. Targets must be concrete package-relative paths and may not escape their package through symlinks. A missing build artifact fails Quality CI rather than surfacing later in an external consumer. It is a structural check; it does **not** replace clean `pnpm pack` / external installation or runtime import acceptance.
