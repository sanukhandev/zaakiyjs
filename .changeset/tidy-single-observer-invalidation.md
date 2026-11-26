---
"@zaakiyjs/signals": patch
---

Avoid allocating an observer snapshot for zero- and one-subscriber signal or computed invalidations. Preserve snapshot iteration for multiple observers and all existing reactive scheduling and disposal semantics.
