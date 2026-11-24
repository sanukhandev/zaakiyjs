---
"@zaakiyjs/vite-plugin": patch
---

Deduplicate identical generated asset records in `zaakiy-assets.json` so each emitted filename is represented once. Reject conflicting filename metadata instead of emitting ambiguous manifest entries.
