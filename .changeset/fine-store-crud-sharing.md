---
"@zaakiyjs/store": patch
---

Preserve referential identity for unchanged nested records already defensively frozen by the same owner-scoped Store. External and cross-store inputs remain deeply copied. This avoids unnecessary keyed DOM updates after single-record CRUD edits.
