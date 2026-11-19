---
"@zaakiyjs/ssr": minor
---

Expose browser-safe `hydrateRegionRoute` to commit compiler-generated H4 region hydration only inside a current H5 navigation transaction. Reject stale/wrong-route commits and dispose adopted listeners and effects when navigation is cancelled. Retains existing SSR marker/manifest preflight and native node identity; no SSR compiler or DOM ABI changes.
