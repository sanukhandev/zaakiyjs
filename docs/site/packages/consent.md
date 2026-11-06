---
title: "@zaakiyjs/consent"
description: "Fail-closed purpose decisions, CMP adapters, storage and revocable vendor activation"
sidebar_position: 20
---

# @zaakiyjs/consent

Use Consent to gate optional analytics, advertising and third-party resources before they load.

> **Availability:** Source implementation in ZaakiyJS, not a verified published npm release. The package's manifest at the referenced revision uses `0.0.0`; use workspace tooling until independent publishing is approved.

## At a glance

- **Use it when:** Create a per-app consent manager, await restoration, inject its capability into optional packages, and tear down vendors on withdrawal.
- **Reference revision:** [9f6c6603c98c](https://github.com/sanukhandev/zaakiyjs/commit/9f6c6603c98ca566c2fed6fed34cc770f6a72960).

## Try it in the monorepo

```sh
pnpm --filter @zaakiyjs/consent typecheck
pnpm --filter @zaakiyjs/consent test
pnpm --filter @zaakiyjs/consent build
```

## Feature usage: first working pattern

```ts
import { createConsentManager, createConsentActivation, createMemoryConsentStorage } from '@zaakiyjs/consent';

const manager = createConsentManager({
  purposes: ['analytics', 'advertising'] as const,
  policy: {
    id: 'privacy', version: '1', region: 'deployment-selected',
    maxAgeMs: 180 * 24 * 60 * 60 * 1000
  },
  storage: createMemoryConsentStorage()
});
const vendor = createConsentActivation({
  gate: manager, purposes: ['analytics'],
  activate: ({ signal }) => {
    signal.throwIfAborted();
    return () => { /* stop optional vendor */ };
  }
});
await manager.ready;
manager.grant('analytics');
// Cleanup: vendor.dispose(); manager.dispose();
```

## Usage and correctness guidelines

- Unknown/expired purpose decisions deny optional work; storage records are not proof of current permission.
- Consent capability `zaakiy.consent/1` is the cross-package contract; do not pass the internal storage record as an Ads/Analytics snapshot.
- Legality, vendor deletion, third-party cookies and server-side gating remain deployment responsibilities.

## Public API index

Exported symbols detected in the package root `src/index.ts`. Platform-specific subpaths and structural contracts are explained in the detailed guide and package manifest.

- `CMPAdapter`
- `CMPConnection`
- `CMPDecision`
- `CMPMapping`
- `CONSENT_PURPOSES_V1`
- `CONSENT_SCHEMA_V1`
- `ConsentActivation`
- `ConsentActivationOptions`
- `ConsentCapabilityV1`
- `ConsentChange`
- `ConsentCleanup`
- `ConsentCmpAdapterV1`
- `ConsentDecisionV1`
- `ConsentGate`
- `ConsentGrantV1`
- `ConsentManager`
- `ConsentManagerOptions`
- `ConsentPolicy`
- `ConsentPolicyAdapterV1`
- `ConsentPurposeV1`
- `ConsentReason`
- `ConsentRecord`
- `ConsentResourceV1`
- `ConsentSnapshotListenerV1`
- `ConsentSnapshotV1`
- `ConsentStatus`
- `ConsentStorage`
- `ConsentStorageAdapterV1`
- `ConsentWithdrawalReason`
- `CookieConsentStorageOptions`
- `CookieJar`
- `PurposeDecision`
- `PurposeDefinition`
- `VerifiedCMPMessageOptions`
- `connectCMP`
- `createConsentActivation`
- `createConsentManager`
- `createCookieConsentStorage`
- `createMemoryConsentStorage`
- `createServerSessionConsentStorage`
- `decodeConsentRecord`
- `decodeConsentSnapshotV1`
- `mapCMPDecisions`
- `parseVerifiedCMPMessage`
- `serializeConsentRecord`

## Detailed feature guide

### Example

```ts
import { createConsentManager, createConsentActivation, createCookieConsentStorage } from '@zaakiyjs/consent';

const manager = createConsentManager({
  purposes: ['analytics', 'advertising', 'ad-personalization'] as const,
  policy: { id: 'privacy-policy', version: '2026-11', region: 'deployment-selected', maxAgeMs: 1000 * 60 * 60 * 24 * 180, gpcPurposes: ['advertising'] },
  storage: createCookieConsentStorage({ jar: document, secure: true, sameSite: 'Lax' })
});
const optionalVendor = createConsentActivation({
  gate: manager,
  purposes: ['analytics', 'advertising'],
  activate: ({signal}) => { /* app initializes its approved, abortable vendor ONLY here */
    signal.throwIfAborted();
    return () => { /* release SDK listeners and clear framework-managed optional state */ };
  },
  onRevoke: () => { /* app requests provider-side withdrawal where supported */ }
});
await manager.ready;
const capability = manager.capability; // structural zaakiy.consent/1, inject into Analytics / Ads
console.log(capability.can('analytics')); // false until granted
const off = capability.subscribe((next, previous) => {
  // exactly one monotonic revision per committed consent update
});
manager.grant('analytics');  // advertising remains denied
manager.deny('advertising');
// On application cleanup:
off(); optionalVendor.dispose(); manager.dispose();
```

Initial `unknown` denies optional work; storage restore is asynchronous and blocks until `ready` unless explicitly resolved by a current user action. `initialSnapshot` accepts `{trusted:true,snapshot}` (validated frozen protocol) or `{trusted:true,record}` (internal storage record) from request-scoped trusted server code; a browser-supplied object is not proof of consent. Expired/mismatched records cannot authorize. `updatePolicy()` invalidates grants when the version changes. Managers do not share state across app roots or server requests. Scope registration automatically disposes a manager created within the current Core owner (or with an explicit owner).

Consent status is per purpose: `unknown | granted | denied | revoked | expired`. `isAllowed()` also applies configured GPC/DNT policy constraints. `states` and `policyVersion` are read-only reactive signals. `subscribe(purpose, listener)` emits permission transitions and `onChange` emits decision details. Preference changes use atomic commits; repeated decisions are idempotent.

For storage, prefer the in-memory adapter in tests and SSR. Cookie storage requires an explicit host-only cookie jar, secure/same-site settings and size budget. It persists only decision/status/timestamps, not identifiers. A server-session adapter delegates all authentication, isolation, integrity and account synchronization to the host. Browser-only cookies do **not** imply cross-device synchronization or tamper-proof consent. Cookies can be disabled; persisted consent may then be unavailable. All persistence errors can be observed with `onError`; optional vendor authorization must remain fail-closed.

The CMP contract accepts **untrusted data**. `mapCMPDecisions()` maps allowlisted vendor IDs and validates `granted/denied/revoked`; `parseVerifiedCMPMessage()` requires exact source, origin and event type. `connectCMP` handles listener teardown and ignores stale initial reads after live updates. There is intentionally no hardcoded IAB TCF/GPP or provider certification claim; vendor-specific adapters require verified current APIs and separate conformance suites.

On revocation or owner disposal, active resources receive AbortSignal cancellation, cleanup and an optional typed withdrawal reason. In-flight requests, queued data, cookies and provider-side deletion require the **actual vendor adapter** to implement cancellation/storage purge/withdrawal. Third-party data already transmitted cannot be reversed. Some scripts cannot be fully unloaded and require isolation or a reload. The activation helper serializes async teardown and pending startup completion before a replacement vendor is allowed to start; an SDK that ignores AbortSignal still requires vendor-specific isolation. The engine itself does not inject scripts, preconnect, preload, collect data or set optional identifiers. **Applications must also gate server-rendered scripts/resource hints, sendBeacon, fetch and any vendor SDK initialization using the gate before performing optional work.**

Policies must be configured and legally reviewed per deployment. This package does not guarantee GDPR, UAE PDPL, ePrivacy or any other legal compliance. GPC/DNT are only enforced for explicitly selected purposes; the application determines their applicability and supplies authoritative signal flags without geolocation inference.

### Frozen P3 capability and deployment constraints

P3 Contract 15 defines the frozen consent capability used by optional packages. `manager.capability` implements the structural `zaakiy.consent/1` interface: `schema`, `snapshot()` with monotonic revision, policy ID/version, region and all five canonical grants; `can(purpose)`; and `subscribe((next,previous)=>{})`. Frozen grant decisions are `unknown|granted|denied|revoked`; internal `expired` maps to the fail-closed `unknown` transport decision. The storage-facing `manager.snapshot()` is a **different**, versioned internal `ConsentRecord` and must not be passed to Analytics/Ads.

Supported canonical purposes: `essential`, `analytics`, `advertising`, `ad-personalization`, `functional-third-party`. `personalization` is not a frozen alias for ad personalization. Unknown purposes remain unauthorized. A deployment must explicitly configure `{allowEssential:true}` alongside an essential declaration to classify essential operations; this does not approve third-party vendors. Policy ID/region/version changes revoke earlier grants. Only the host can verify legal basis and policy applicability.

## Integrate with neighboring packages

- [@zaakiyjs/ads](./ads.md)
- [@zaakiyjs/ssr](./ssr.md)
- [@zaakiyjs/core](./core.md)
- [@zaakiyjs/ui](./ui.md)

## Source and maintenance

- [Package README](https://github.com/sanukhandev/zaakiyjs/blob/9f6c6603c98ca566c2fed6fed34cc770f6a72960/packages/consent/README.md)
- [Public source exports](https://github.com/sanukhandev/zaakiyjs/blob/9f6c6603c98ca566c2fed6fed34cc770f6a72960/packages/consent/src/index.ts)
- [Package test cases](https://github.com/sanukhandev/zaakiyjs/tree/9f6c6603c98ca566c2fed6fed34cc770f6a72960/packages/consent/test)
- Update this page when public APIs, runtime semantics or platform guarantees change.
