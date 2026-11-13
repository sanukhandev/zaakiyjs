---
"@zaakiyjs/compiler": minor
"@zaakiyjs/dom": minor
"@zaakiyjs/ssr": minor
---

Introduce opt-in compiler-authored v2 native hydration plans and browser
adoption without changing the v1 DOM or data-hydration ABI. Support bounded
nested keyed/conditional regions, local and SHA-256-pinned imported TSX
components, default and named compile-time slots, audited JSX direct-action
event factories, owner-scoped cleanup, explicit public-state initialization,
and transactional recovery of a single compiler-owned mismatched boundary.

The browser receives precompiled event modules, never executable SSR source.
Unsupported closure statements, dynamic component graphs and untrusted state
remain fail-closed; no arbitrary TSX hydration or matched framework
benchmark superiority is claimed.
