---
"@zaakiyjs/dom": patch
"@zaakiyjs/router": patch
---

Improve sparse keyed DOM reconciliation using a minimum-move strategy while preserving native node identity, focus, selection, and owner cleanup across browsers.

Precompute validated nested route matching metadata and preserve safe, immutable inherited parameter snapshots.

No public API or compiler/DOM ABI contract changes. These are independently versioned patch-release intents only; no publication is authorized by this changeset.
