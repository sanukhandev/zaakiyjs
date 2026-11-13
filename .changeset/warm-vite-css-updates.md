---
"@zaakiyjs/vite-plugin": patch
---

Preserve the old compiled style contribution through TSX watcher invalidation so source-only development edits skip redundant CSS regeneration. Style token changes still recompile and invalidate styles, while stateful HMR continues to use a safe full reload.
