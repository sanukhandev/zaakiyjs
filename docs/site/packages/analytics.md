---
title: "@zaakiyjs/analytics (planned)"
description: "P3 analytics contract: typed events, Web Vitals and consent-controlled delivery"
sidebar_position: 23
---

# @zaakiyjs/analytics — design contract

> **Status: Not an implemented package on the documented main revision.** The frozen [Analytics v1 design](../../contracts/16-analytics.md) describes intended interfaces and gates; no public runtime import or provider is asserted.

## Problem and intended use

Offer optional product analytics without importing a tracking provider into bare Core applications, gathering data before consent, intercepting browser globals or affecting navigation/render performance.

Use cases include explicit business events, validated conversion goals, committed route pageviews and opted-in Web Vitals measurements.

## Proposed event model

| Event kind | Frozen payload intent | Critical rules |
| --- | --- | --- |
| `event` | `AnalyticsEventV1` | Allowlisted event name and bounded scalar properties |
| `conversion` | `ConversionEventV1` | Dedupe key, goal ID, optional value/currency; no double credit |
| `pageview` | `PageviewEventV1` | Route ID and sanitized same-origin path; **after** Router commit |
| `web-vital` | `WebVitalEventV1` | LCP/INP milliseconds, CLS unitless, rating and navigation type |
| Provider | `AnalyticsProviderV1` | Explicit async start/send/flush/dispose using AbortSignal |
| Client | `AnalyticsClientV1` | Accepted/blocked/sampled-out/invalid outcomes |

All names are currently **design contract types**, not verified installed runtime exports.

## Intended usage lifecycle

1. App creates a request/app-scoped Consent manager and determines the applicable policy.
2. Before permission is granted, Analytics does **not** initialize a provider, assign an optional identity, observe Web Vitals or queue/send records.
3. After an explicit analytics grant, the app activates an approved provider adapter with a native AbortSignal.
4. Only allowed, validated events enter bounded queues. Configured sampling, payload/size caps and duplicate suppression run before transmission.
5. A successfully **committed** route transition may produce one pageview; denied, redirected or aborted attempts are not pageviews.
6. On revocation, abort requests, discard the entire queue and identity, disconnect observers and dispose the provider.
7. A later grant creates a **fresh** provider lifecycle. No pre-consent history is replayed.

Importing a package is not itself a basis for telemetry.

## Privacy and quality gates

Reject free-form personal information such as email, phone, tokens, cookies, full referrer URLs and search query strings. Identity must be post-consent, ephemeral by default and policy-reviewed when authenticated. Diagnostics should report coarse error codes/counts only.

Provider errors, blocked endpoints and browser privacy controls must not break rendering. Backoff must be bounded and abortable; queue overflow drops records instead of retaining unbounded data. Performance observer behavior needs verified browser support, navigation-specific interpretation and cleanup.

## Acceptance before runtime publication

Unknown consent must produce **zero** provider calls. Grant should enable only authorized events. Duplicate conversion must send once. Sampling and validation must produce testable outcomes. Revocation during startup/send must cancel safely and dispose once. Browser tests should measure no retained observers/listeners after owner disposal, with no analytics imports in a minimal Core bundle.

## References

- [Analytics design contract](../../contracts/16-analytics.md)
- [Consent package](./consent.md)
- [Router package](./router.md)
- [Ads package](./ads.md)
- [P3 dependency matrix](../../contracts/p3-dependency-integration-matrix.md)
