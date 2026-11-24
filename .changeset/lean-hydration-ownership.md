---
"@zaakiyjs/ssr": patch
"@zaakiyjs/signals": patch
"@zaakiyjs/core": patch
---

Consolidate hydration element/event discovery while preserving preflight validation and event resolution order. Avoid allocating empty attribute-validation sets and listener arrays. Allocate computed-read maps and owner resource collections only when required. No public API, IR, marker-format or scheduler ordering change is intended.
