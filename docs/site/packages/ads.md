---
title: "@zaakiyjs/ads"
description: "Opt-in consent-aware display ad slots, provider lifecycle and route-scoped placements"
sidebar_position: 21
---

# @zaakiyjs/ads

Use Ads to manage pre-approved display provider adapters, reserved slot space and teardown on consent revocation.

> **Availability:** Source implementation in ZaakiyJS, not a verified published npm release. The package's manifest at the referenced revision uses `0.0.0`; use workspace tooling until independent publishing is approved.

## At a glance

- **Use it when:** Inject a valid consent capability and reviewed provider, register display slots, then mount them on stable native placeholder nodes.
- **Reference revision:** [9f6c6603c98c](https://github.com/sanukhandev/zaakiyjs/commit/9f6c6603c98ca566c2fed6fed34cc770f6a72960).

## Try it in the monorepo

```sh
pnpm --filter @zaakiyjs/ads typecheck
pnpm --filter @zaakiyjs/ads test
pnpm --filter @zaakiyjs/ads build
```

## Feature usage: first working pattern

```ts
import { createAdsManagerV1 } from '@zaakiyjs/ads';

// `consentCapability` and `provider` are injected, approved adapters.
const manager = createAdsManagerV1({
  scopeId: 'app1', consent: consentCapability, provider,
  policy: {
    version: 1, providerId: 'reviewed', allowPlacements: ['home/top'],
    requiredPurposes: ['advertising'], personalized: false,
    maxSlots: 1, loadTimeoutMs: 8000
  }
});
const slot = manager.register({
  schema: 'zaakiy.ads/1', id: 'top', placement: 'home/top',
  formats: ['display'], dimensions: [{ width: 300, height: 180 }],
  reserve: { minWidth: 300, minHeight: 180 },
  requiredPurposes: ['advertising'], personalized: false
});
slot.mount(document.querySelector('[data-zaakiy-ad-slot="top"]')!);
// Route teardown: await slot.dispose(); await manager.dispose();
```

## Usage and correctness guidelines

- No ad network SDK, impression tracking or monetization is included automatically.
- Advertising and personalized advertising require their respective purposes; analytics consent cannot unlock ad display.
- Ad scripts may not be fully unloadable after evaluation; providers must document revocation and reload behavior.

## Public API index

Exported symbols detected in the package root `src/index.ts`. Platform-specific subpaths and structural contracts are explained in the detailed guide and package manifest.

- `AdMountedPlacementV1`
- `AdPlacementHandleV1`
- `AdPlacementOptionsV1`
- `AdPolicyV1`
- `AdProviderV1`
- `AdProviderWithRefreshV1`
- `AdRouteHandleV1`
- `AdRouteSourceV1`
- `AdScriptLeaseV1`
- `AdScriptOptionsV1`
- `AdSlotStateV1`
- `AdSlotV1`
- `AdsEventV1`
- `AdsManagerOptionsV1`
- `AdsManagerV1`
- `AdvertisingPurposeV1`
- `ConsentCapabilityV1`
- `ConsentDecisionV1`
- `ConsentGrantV1`
- `ConsentPurposeV1`
- `ConsentSnapshotV1`
- `RouteAdsOptionsV1`
- `RoutePlacementOptionsV1`
- `bindAdsToRoutes`
- `bindAdsV1ToRoutes`
- `createAdsManager`
- `createAdsManagerV1`
- `loadAuthorizedProviderScript`
- `loadAuthorizedProviderScriptV1`
- `renderAdSlotPlaceholder`
- `renderAdSlotPlaceholderV1`

## Detailed feature guide

### Canonical frozen P3 v1 interface

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

### Public exports and integration

Only the frozen P3 v1 interfaces are exported from the package root. `createAdsManager`, `bindAdsToRoutes`, `renderAdSlotPlaceholder` and `loadAuthorizedProviderScript` are convenient aliases of their versioned `*V1` counterparts. Earlier draft `check(purposes)` code is retained privately for regression tests only; it is not a supported public integration boundary.

`renderAdSlotPlaceholderV1(slot)` produces escaped, width/height-reserved SSR markup matching the browser's `data-zaakiy-ad-slot` identity. No vendor scripts run on the server. Use `bindAdsV1ToRoutes(manager, committedRouteSource, { allowRoutes })` to opt into page-scoped placements; non-allowlisted private routes cannot register ads. Persistent shell placements are explicit.

`loadAuthorizedProviderScriptV1` requires an injected frozen Consent capability, `advertising` purpose, approved HTTPS origins, a cancellation signal and optional nonce/SRI attributes. It deduplicates authorized requests, bounds concurrent script loads, rechecks consent on changes and returns an explicit disposable script lease. Once a previously loaded SDK script is released, further injection of the same script in that document is blocked: a new page load is required because removing a script tag cannot unload evaluated SDK globals. **No real advertising provider SDK is shipped or called automatically.**

### Validation / release gates

Ads is present in the current source workspace. Review package integrations and independently validate published artifacts before release. Unit and jsdom mock tests are not substitutes for real-browser CSP, CLS, keyboard-focus and provider-policy tests. No SDK integration, ad-block bypass, network analytics transport or automatic monetization exists. Independent npm `pack`, no-Ads browser tree-shake, npm scope/ownership and release metadata must pass before publication.

## Integrate with neighboring packages

- [@zaakiyjs/consent](./consent.md)
- [@zaakiyjs/ssr](./ssr.md)
- [@zaakiyjs/router](./router.md)
- [@zaakiyjs/ui](./ui.md)

## Source and maintenance

- [Package README](https://github.com/sanukhandev/zaakiyjs/blob/9f6c6603c98ca566c2fed6fed34cc770f6a72960/packages/ads/README.md)
- [Public source exports](https://github.com/sanukhandev/zaakiyjs/blob/9f6c6603c98ca566c2fed6fed34cc770f6a72960/packages/ads/src/index.ts)
- [Package test cases](https://github.com/sanukhandev/zaakiyjs/tree/9f6c6603c98ca566c2fed6fed34cc770f6a72960/packages/ads/test)
- Update this page when public APIs, runtime semantics or platform guarantees change.
