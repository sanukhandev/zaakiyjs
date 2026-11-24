---
"@zaakiyjs/proxy": patch
---

Index validated proxy routes by their longest static leading path prefix,
reducing unnecessary regex scans without changing route ordering, method-specific
405 Allow headers, parameterized/wildcard matching, authentication, SSRF or
request validation. No public API change or implicit publication.
