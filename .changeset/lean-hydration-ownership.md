---
"@zaakiyjs/ssr": minor
"@zaakiyjs/signals": patch
"@zaakiyjs/core": patch
"@zaakiyjs/dom": minor
"@zaakiyjs/compiler": minor
---

Consolidate hydration element/event discovery; lazily allocate computed reads, row reactive cells and owner resource collections. Avoid allocating a keyed reconciliation map for an equal validated snapshot while preserving key callback order and duplicate rejection. Add opt-in large-tier `hydrationMarkerFormat: "compact-v2"` for eligible sole item-derived scalar elements, using the verified native element as the text boundary instead of two comments. The previous standard and compact-v1 layouts remain supported; server and client must use a matching compiled plan. Add explicit opt-in `itemDataMode: "snapshot"` for immutable plain keyed item data without reactive descriptor reads; default tracked reads are unchanged. No scheduler ordering or existing DOM ABI change is intended.

Add the opt-in compact-v3 large-tier native scalar-row format and additive compiler-only flat list binding primitive. Eligible immutable rows use a verified native key attribute and one list-owned effect instead of individual range markers and row owners. Complex rows retain their existing scoped behavior. The existing v1 ABI and prior marker formats remain unchanged.
