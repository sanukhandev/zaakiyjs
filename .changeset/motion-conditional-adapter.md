---
"@zaakiyjs/motion": minor
---

Add an opt-in `bindAnimatedConditionalRegion` bridge to the existing DOM single-Element exit-aware conditional region contract. Keep focused native nodes and child owners during bounded WAAPI exits, abort stale animations on re-entry, respect reduced-motion, and release owned resources on parent unmount. No automatic JSX/Router/keyed lowering is implied.
