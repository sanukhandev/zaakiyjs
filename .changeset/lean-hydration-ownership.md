---
"@zaakiyjs/ssr": minor
"@zaakiyjs/signals": patch
"@zaakiyjs/core": patch
"@zaakiyjs/dom": patch
"@zaakiyjs/compiler": minor
---

Consolidate hydration element/event discovery; lazily allocate computed reads, row reactive cells and owner resource collections. Avoid allocating a keyed reconciliation map for an equal validated snapshot while preserving key callback order and duplicate rejection. Add opt-in large-tier `hydrationMarkerFormat: "compact-v2"` for eligible sole item-derived scalar elements, using the verified native element as the text boundary instead of two comments. The previous standard and compact-v1 layouts remain supported; server and client must use a matching compiled plan. Add explicit opt-in `itemDataMode: "snapshot"` for immutable plain keyed item data without reactive descriptor reads; default tracked reads are unchanged. No scheduler ordering or existing DOM ABI change is intended.
