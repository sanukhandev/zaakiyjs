---
"@zaakiyjs/compiler": minor
"@zaakiyjs/vite-plugin": patch
---

Add a Node-only per-build TypeScript diagnostics session to reuse semantic
program state across TSX compilation. Preserve standalone compile() behavior,
diagnostics, IR/code/source-map output and fail-closed browser checks. The Vite
integration owns session creation, file invalidation and deterministic disposal.

The Vite integration also reuses stable dependency hashes and skips virtual CSS
invalidations when emitted CSS and its source map remain unchanged.
