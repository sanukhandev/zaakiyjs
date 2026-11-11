---
"@zaakiyjs/signals": patch
---

Lazily allocate computed-value tracking snapshots only when effects read derived
signals. Direct-signal-only bindings retain existing dependency tracking,
scheduling, cancellation and disposal semantics without the unused Map.
No public API or ABI changes.
