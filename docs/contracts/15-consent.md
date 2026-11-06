# Contract 15 — consent capability and policy adapters (P3 consent v1)

- **Status:** Frozen transport-neutral **design**, not implemented.
- **Owner:** proposed `@zaakiyjs/consent`. Contract ID `zaakiy.consent/1`.
- **Dependency principle:** Analytics/Ads accept this **structural capability** as an injected object; neither needs the Consent implementation to compile during parallel development. No global default consent manager.

## Protocol (reserved)

~~~ts
type ConsentPurposeV1 =
  | "essential" | "analytics" | "advertising" | "ad-personalization" | "functional-third-party";
type ConsentDecisionV1 = "unknown" | "granted" | "denied" | "revoked";
interface ConsentGrantV1 {
  readonly purpose: ConsentPurposeV1;
  readonly decision: ConsentDecisionV1;
  readonly updatedAt?: string; // ISO 8601, bounded/auditable
  readonly source?: "user" | "policy" | "cmp" | "server";
}
interface ConsentSnapshotV1 {
  readonly schema: "zaakiy.consent/1";
  readonly revision: number; // monotonic per scope
  readonly policyId: string; readonly policyVersion: string;
  readonly region?: string; // coarse policy key, not precise location
  readonly grants: Readonly<Record<ConsentPurposeV1, ConsentGrantV1>>;
}
interface ConsentCapabilityV1 {
  readonly schema: "zaakiy.consent/1";
  snapshot(): ConsentSnapshotV1;
  can(purpose: ConsentPurposeV1): boolean;
  subscribe(listener: (next: ConsentSnapshotV1, previous: ConsentSnapshotV1) => void): () => void;
}
interface ConsentPolicyAdapterV1 {
  readonly version: 1; readonly id: string;
  evaluate(context: { readonly region?: string; readonly appPolicy: string;
    readonly claimedAgeClass?: "unknown" | "adult" | "minor" }):
    { readonly policyVersion: string; readonly initial: ConsentSnapshotV1;
      readonly purposesRequiringOptIn: readonly ConsentPurposeV1[] };
}
interface ConsentStorageAdapterV1 {
  readonly version: 1;
  read(scope: string, signal: AbortSignal): Promise<ConsentSnapshotV1 | null>;
  write(scope: string, value: ConsentSnapshotV1, signal: AbortSignal): Promise<void>;
  clear(scope: string, signal: AbortSignal): Promise<void>;
}
interface ConsentCmpAdapterV1 {
  readonly version: 1;
  read(): Promise<ConsentSnapshotV1 | null>;
  subscribe(listener: (snapshot: ConsentSnapshotV1) => void): () => void;
  dispose(): void;
}
interface ConsentResourceV1 {
  readonly purposes: readonly ConsentPurposeV1[];
  revoke(reason: "denied" | "revoked" | "policy-changed" | "owner-disposed"): void | Promise<void>;
}
~~~

Interfaces are **documentation**, not new imports. A future `@zaakiyjs/consent` public entrypoint may expose only types in a side-effect-free `/contract` subpath for optional consumers, but must not force its state engine into Analytics/Ads. Independent agents must conform to this exact structural ID, purpose names and decision meanings; adapters may be supplied by the application.

## Effective permission rules

`essential` is a **classification** for strictly necessary app operations, not carte blanche for vendors. Its allowed operations come only from a configured policy adapter. For every **optional** purpose, `unknown`, `denied` and `revoked` MUST return `false` from `can()`, including during hydration, race conditions, region changes and CMP failure. `advertising` approval does **not** imply `ad-personalization`; personalization needs its own grant when applicable. `analytics` is separate from ads and functional third-party integrations. Dependencies across purposes must be evaluated explicitly (e.g. a personalized ad requires both advertising and ad-personalization grants).

Notifications are delivered once per committed revision, ordered within an owner, with old and new snapshots and idempotent unsubscribe. Validation rejects unknown schema, malformed decisions, stale revisions and unsupported purposes rather than converting them to permission. Client consent can differ from server initial state; reconcile policy/revision before activating optional providers. **No speculative initial script/network call** for optional services.

SSR initial consent is per **request** from a trusted policy/CMP server adapter, not mutable process-global state. Do not serialize raw CMP strings, cookies, user IDs or sensitive geolocation into a public HTML cache. If consent-dependent markup cannot be safely partitioned, render privacy-neutral placeholders (`unknown`). The browser rechecks effective permission after hydration, before loading optional vendors.

## Revocation and cleanup

A consumer registers its `ConsentResourceV1` on the owning Core scope; when any required purpose moves out of `granted`, deactivate immediately, abort pending provider loads, stop observers/timers/event queues, remove injected scripts/iframes where possible and call `revoke`/`dispose` exactly once. Subscriptions and resources dispose on page/app owner teardown. Drop locally queued unsent optional telemetry; provider-side erasure cannot be assumed and must be documented per vendor. If storage/CMP read fails or policy is absent, optional permissions are `unknown` and fail closed. UI can still offer an explicit consent decision path without pre-loading trackers.

## Regional policy and storage

Legal requirements differ by jurisdiction, age, service and purpose. The framework **does not embed legal conclusions** or guess region from client IP. App supplies and versions region policy, residency, CMP behavior, retention, proof-of-consent and storage adapters. A region change or stricter policy version triggers re-evaluation/revocation. Storage requires secure, bounded first-party adapters; an invalid persistent snapshot must not grant permission. Accessibility: consent UI must have keyboard focus, clear purpose choices and a usable decline/revisit path.

## Required tests

Unknown/denied/revoked all block analytics, ads and personalization; analytics-only does not permit ads; advertising-only does not permit personalization; SSR unknown -> client grant; grant -> revoke during async provider load; stale CMP revision; storage failure; regional policy change; tenant/app isolation; cleanup and no network before optional grant. No legal certification or concrete CMP is claimed by this freeze.
