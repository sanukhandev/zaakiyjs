---
"@zaakiyjs/dom": patch
---

Skip native DOM adjacency checks and focus snapshots when keyed loops receive a new array with identical keys and item identities in the same order. Preserve validation, same-key updates and existing reorder behavior.
