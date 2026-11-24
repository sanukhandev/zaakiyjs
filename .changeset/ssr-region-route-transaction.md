---
"@zaakiyjs/ssr": minor
---

Add `hydrateRegionRoute` to the browser-side SSR client API. It reuses the existing compiler-backed keyed/conditional region adoption and the H5 navigation transition coordinator, rejecting stale or mismatched routes before attachment and disposing listeners when navigation aborts.
