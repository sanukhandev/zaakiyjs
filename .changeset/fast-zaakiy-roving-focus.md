---
"@zaakiyjs/ui-primitives": patch
---

Batch initial roving-focus item registration and owner teardown to avoid
repeated DOM sorting and style inspection, while preserving the initialId,
keyboard navigation, active tabindex, focus and owner-scoped cleanup.
No public API or DOM ABI changes.
