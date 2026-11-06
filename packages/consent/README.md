# @zaakiyjs/consent

P3 draft, **unpublished**. Privacy-first, signal-driven decision state machine for optional analytics, advertising, personalization and external vendors. Requires `@zaakiyjs/core` and `@zaakiyjs/signals`; no Analytics, Ads or server SSR imports.

## Example

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

## Frozen P3 capability and deployment constraints

P3 Contract 15 is now frozen on `main` (PR #50, `P3_BASE_SHA=0f23943a17401170980f66e69e1fd03b2a82a3c3`). `manager.capability` implements the structural `zaakiy.consent/1` interface: `schema`, `snapshot()` with monotonic revision, policy ID/version, region and all five canonical grants; `can(purpose)`; and `subscribe((next,previous)=>{})`. Frozen grant decisions are `unknown|granted|denied|revoked`; internal `expired` maps to the fail-closed `unknown` transport decision. The storage-facing `manager.snapshot()` is a **different**, versioned internal `ConsentRecord` and must not be passed to Analytics/Ads.

Supported canonical purposes: `essential`, `analytics`, `advertising`, `ad-personalization`, `functional-third-party`. `personalization` is not a frozen alias for ad personalization. Unknown purposes remain unauthorized. A deployment must explicitly configure `{allowEssential:true}` alongside an essential declaration to classify essential operations; this does not approve third-party vendors. Policy ID/region/version changes revoke earlier grants. Only the host can verify legal basis and policy applicability.

The implementation PR includes its frozen workspace lockfile importer and workspace verifier registration because real CI cannot run without those files. Frozen installs and complete GitHub checks must pass before the draft can be marked ready. No vendor SDK, IAB TCF/GPP certification, legal compliance or npm publication claim is implied.

