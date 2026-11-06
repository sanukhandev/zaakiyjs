# @zaakiyjs/ads

P3-00 contract-aligned, optional browser advertising controllers with no bundled ad SDK. This source package is **not yet published**. No fill, revenue, impression, third-party policy approval or legal certification is promised.

## Canonical frozen P3 v1 interface

`createAdsManagerV1` implements Contract 17 (`zaakiy.ads/1`) and accepts Contract 15's injected `ConsentCapabilityV1` (`zaakiy.consent/1`). The consumer checks every required grant via `snapshot()` and `can(purpose)`, not a process-global consent service. Neither the concrete Consent engine nor Analytics is imported.

```ts
import { createAdsManagerV1 } from "@zaakiyjs/ads";

const manager = createAdsManagerV1({
  scopeId: "app1",
  consent: appConsentCapability,  // injected frozen ConsentCapabilityV1
  provider: reviewedAdProvider,   // explicitly supplied AdProviderV1
  policy: {
    version: 1, providerId: "reviewed", allowPlacements: ["home/top"],
    requiredPurposes: ["advertising"], personalized: false,
    maxSlots: 2, loadTimeoutMs: 8000
  }
});
const slot = manager.register({
  schema: "zaakiy.ads/1", id: "topAd", placement: "home/top",
  formats: ["display"], dimensions: [{ width: 300, height: 180 }],
  reserve: { minWidth: 300, minHeight: 180 },
  requiredPurposes: ["advertising"], personalized: false
}, { lazy: true });
slot.mount(document.querySelector('[data-zaakiy-ad-slot="topAd"]')!);

// Route exit / owner teardown: unsubscribe, abort and await provider removal.
await slot.dispose();
await manager.dispose();
```

**Contract rules:** `AdSlotV1`, `AdPolicyV1`, `AdProviderV1`, `AdPlacementHandleV1` and the nine `AdSlotStateV1` values preserve the frozen schema, provider version and purpose vocabulary. The provider's `start`, `load`, `remove` and `dispose` methods are explicit. Only `display` format is initially accepted; native/video formats are rejected until their separate provider and UX guarantees exist.

Permission is always evaluated for the union of advertising, policy purposes and slot purposes. Personalized placement requires both `advertising` and `ad-personalization`; granting analytics cannot unlock ads. An invalid schema, malformed grant snapshot, absent consent, unknown region/policy, or throwing capability fails closed. No third-party resource starts before all purposes are authorized. A revocation aborts in-flight work and retires provider resources; a later grant requires a fresh provider `start`. Because an opaque vendor may ignore abort or retain global state, adapters must document incomplete SDK unload behavior.

The manager uses reserved `minWidth`, `minHeight` and optional `aspectRatio` directly on the slot element. SSR can render `renderAdSlotPlaceholder` (escaped markup) and the browser can adopt the same stable `data-zaakiy-ad-slot` ID. The manager never imports a server-rendering engine or inserts scripts during module initialization. Use dimensions that fit the actual responsive container. A compliant display provider is responsible for avoiding creative-induced CLS.

**Refresh is disabled by default.** A provider must explicitly implement the `AdProviderWithRefreshV1` extension and declare `minRefreshIntervalMs >= 30000`, and the slot must also opt in with `refreshMinIntervalMs >= 30000`. Intervals are enforced; no timer or navigation automatically refreshes a placement. Provider-specific refresh policies still need validation. A slot-level async timeout uses `policy.loadTimeoutMs` and aborts on expiration. No raw provider exception or account credential is copied to slot state or public events.

## Legacy draft API

The earlier `createAdsManager` and `AdsConsentGate.check` source API remain only for migration/testing of the initial draft branch. They are **not** the P3-00 frozen protocol. Prefer `createAdsManagerV1` for all new code and integrations; remove or migrate the legacy draft before independent first publication. Do not wire the provisional check() interface directly to `@zaakiyjs/consent` without an explicit adapter.

The `loadAuthorizedProviderScript` helper is a low-level allowlisted HTTPS loader (nonce, SRI, authorization, concurrency limit); it does not sandbox an SDK. Its older draft consent signature is still provisional and must be reconciled before release. Scripts are never loaded at package import or manager creation.

## Validation / release gates

Workspace integration is intentionally reviewed in a separate stacked PR; the Ads package branch only owns `packages/ads/**` and its independent Changeset. Unit and jsdom mock tests are not substitutes for real-browser CSP, CLS, keyboard-focus and provider-policy tests. No SDK integration, ad-block bypass, network analytics transport or automatic monetization exists. Independent npm `pack`, no-Ads browser tree-shake, npm scope/ownership and release metadata must pass before publication.
