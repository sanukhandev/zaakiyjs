---
title: "@zaakiyjs/analytics"
description: "Implemented source package: typed events, Web Vitals and consent-controlled delivery"
sidebar_position: 23
---

# @zaakiyjs/analytics — source implementation

> **Status: Implemented source package on main after PR #56.** Runtime exports are available in the monorepo; external npm publication remains gated. The [Analytics v1 contract](../../contracts/16-analytics.md) defines its privacy boundaries.

## Public API index

- `createAnalytics`
- `createMemoryProvider`
- `createHttpProvider`
- `EventValue`
- `EventMetadata`
- `EventMap`
- `EventSchema`
- `EventSchemas`
- `ConsentCapabilityV1`
- `ConsentReader`
- `ConsentPurposeV1`
- `ConsentSnapshotV1`
- `ConsentDecisionV1`
- `ConsentGrantV1`
- `AnalyticsBaseV1`
- `AnalyticsEventV1`
- `ConversionEventV1`
- `PageviewEventV1`
- `WebVitalEventV1`
- `AnalyticsRecordV1`
- `AnalyticsRecord`
- `EventCategory`
- `WebVitalNameV1`
- `WebVitalRatingV1`
- `AnalyticsIdentityV1`
- `AnalyticsProviderV1`
- `AnalyticsProvider`
- `ProviderDefinition`
- `AnalyticsPolicyV1`
- `AnalyticsClientV1`
- `TrackResultV1`
- `AnalyticsDiagnostics`
- `IdentityPolicy`
- `AnalyticsOptions`
- `PageviewInput`
- `ConversionInput`
- `Analytics`
- `MemoryProvider`
- `HttpProviderOptions`

## Problem and intended use

Offer optional product analytics without importing a tracking provider into bare Core applications, gathering data before consent, intercepting browser globals or affecting navigation/render performance.

Use cases include explicit business events, validated conversion goals, committed route pageviews and opted-in Web Vitals measurements.

## Event model

| Event kind | Frozen payload intent | Critical rules |
| --- | --- | --- |
| `event` | `AnalyticsEventV1` | Allowlisted event name and bounded scalar properties |
| `conversion` | `ConversionEventV1` | Dedupe key, goal ID, optional value/currency; no double credit |
| `pageview` | `PageviewEventV1` | Route ID and sanitized same-origin path; **after** Router commit |
| `web-vital` | `WebVitalEventV1` | LCP/INP milliseconds, CLS unitless, rating and navigation type |
| Provider | `AnalyticsProviderV1` | Explicit async start/send/flush/dispose using AbortSignal |
| Client | `AnalyticsClientV1` | Accepted/blocked/sampled-out/invalid outcomes |

These event types and provider interfaces are exported by the source package; npm registry availability is not implied.

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
