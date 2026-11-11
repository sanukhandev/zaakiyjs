---
"@zaakiyjs/forms": patch
"@zaakiyjs/analytics": patch
---

Remove repeated full-list issue scans from form-level validation and use linear,
byte-exact UTF-8 batch size accounting for consent-gated analytics delivery.
Both changes preserve public API, cancellation/ownership and security semantics;
no npm publication is authorized.
