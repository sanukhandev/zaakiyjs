---
"@zaakiyjs/forms": patch
---

Speed up validation of passive fields by avoiding redundant full-form cloning
and cancellation-controller allocation when no field validators or required
rules exist. Group form-level issues by path in one pass, preserving issue
ordering, cancellation behavior and public API compatibility.
The separately benchmarked analytics batch rewrite was rejected after it
failed to demonstrate a performance improvement; analytics runtime is unchanged.
No publication is authorized.
