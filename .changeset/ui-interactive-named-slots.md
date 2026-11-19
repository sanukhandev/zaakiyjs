---
"@zaakiyjs/ui": minor
---

Support compiler IR v2 owned named JSX content slots for native Dialog (`body`) and Popover (`content`). Slots retain caller ownership and existing overlay accessibility controllers, mount exactly once, reject forged JSX/HTML values and dispose with the owner. Existing text-based props remain supported.
