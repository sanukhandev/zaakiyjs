---
"@zaakiyjs/ui": minor
---

Enable compiler IR v2 native owned child slots for Container/Stack/Inline/Grid/Flex and Card, preserving existing explicit text item APIs. Slots mount only once through the verified DOM/compiler factory, retain caller ownership, and dispose with the caller. Raw strings, forged slots and repeated mounts fail closed.
