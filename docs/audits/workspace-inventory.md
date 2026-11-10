# Workspace inventory and dependency baseline

Run `node scripts/ci/workspace-inventory.mjs > workspace-inventory.json` to capture a deterministic package/export/dependency snapshot. The command exits nonzero when a package lacks required scripts, exports or a valid manifest, a workspace dependency cannot be resolved, or a dependency cycle is detected.

Run `node --test scripts/ci/workspace-inventory.test.mjs` to exercise the inventory validator with isolated fixtures.

This is a **structural gate**, not a complete API/ABI compatibility test or production certification. Preserve the JSON from the baseline and candidate commits for review; do not assert compatibility solely from equal export-path names. The remaining compatibility gates must inspect declaration signatures, runtime behavior, IR/DOM fixtures, and downstream consumers.
