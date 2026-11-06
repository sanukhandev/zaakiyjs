# Contract 17 — optional ad placements and provider safety (P3 ads v1)

- **Status:** Frozen **design**; no provider integration shipped.
- **Owner:** proposed `@zaakiyjs/ads`; protocol `zaakiy.ads/1`.
- **Dependencies:** only browser owner/DOM primitives and injected Consent capability (Contract 15); no Analytics dependency, global vendor loader, Proxy or Compiler import.

## Placement, lifecycle and capability

~~~ts
interface AdSlotV1 {
  readonly schema: "zaakiy.ads/1";
  readonly id: string; // unique within application root
  readonly placement: string; // app-configured allowlist
  readonly formats: readonly ("display" | "native" | "video")[];
  readonly dimensions: readonly { readonly width: number; readonly height: number }[];
  readonly reserve: { readonly minWidth: number; readonly minHeight: number;
    readonly aspectRatio?: number }; // CLS-safe while empty
  readonly requiredPurposes: readonly ("advertising" | "ad-personalization")[];
  readonly personalized: boolean;
}
type AdSlotStateV1 =
  | "idle" | "awaiting-consent" | "loading" | "ready"
  | "blocked" | "empty" | "failed" | "revoked" | "disposed";
interface AdProviderV1 {
  readonly version: 1; readonly id: string;
  start(context: { readonly signal: AbortSignal; readonly scopeId: string }): Promise<void>;
  load(slot: AdSlotV1, host: HTMLElement, signal: AbortSignal):
    Promise<"filled" | "empty" | "blocked">;
  remove(slotId: string): Promise<void> | void;
  dispose(): Promise<void> | void;
}
interface AdPlacementHandleV1 {
  readonly id: string;
  readonly state: AdSlotStateV1; // observable state may later use existing Signals
  refresh(): Promise<void>;
  dispose(): Promise<void>;
}
interface AdPolicyV1 {
  readonly version: 1;
  readonly providerId: string; readonly allowPlacements: readonly string[];
  readonly requiredPurposes: readonly ("advertising" | "ad-personalization")[];
  readonly personalized: boolean;
  readonly maxSlots: number; readonly loadTimeoutMs: number;
}
~~~

Contract 15's decision/grant vocabulary is authoritative. `requiredPurposes` is the intersection of provider and slot **requirements**, with no implied grant from one purpose to another. Nonpersonalized advertising may require `advertising` only if configured policy permits; personalization requires **both** `advertising` and `ad-personalization`. Essential consent is never a substitute. Unknown/denied/revoked are blocked states, not temporary permission.

## Own the DOM, not the routing engine

The app reserves an explicit measured native element and passes it to a provider adapter under an existing Core owner. Validate IDs, positive bounded dimensions, permitted formats, provider/placement allowlists, sandbox/CSP/ad URL settings and unique slot ownership before initialization. Reserve a responsive minimum or aspect-ratio container **before** remote content loads to prevent CLS; never assume a 0px placeholder. Avoid obscuring content, keyboard traps or auto-playing audio; labels/screen-reader behavior should be accessible and distinguish sponsored content.

One lazy provider lifecycle per allowed application scope; no ad scripts, network beacons, preconnects or iframe insertions before all required grants. Providers are loaded via explicit app-approved imports/URLs; never arbitrary script code or untrusted HTML. Loading is cancellable and idempotent. Refresh is capped and policy-gated, not a navigation listener. A blocked third-party script, ad blocker, CSP denial, timeout or no-fill returns `blocked`/`failed`/`empty`, logs only redacted diagnostics and leaves the reserved container stable; it does not crash the page.

When consent changes to non-granted, stop refresh/timers and in-flight loads, remove vendor nodes/iframes/listeners, revoke identifiers where available, call provider `remove` then `dispose` (idempotently) and move to `revoked`. Disposing the owner tears down all slots. A new grant requires a fresh approved provider start. Any provider analytics is the **provider's consent-governed responsibility**, not an implicit import of `@zaakiyjs/analytics`; if the application chooses to emit ad conversion events, it must explicitly opt into Analytics independently.

## Acceptance gates

Absent permission -> reserved slot only and zero vendor requests; personalized ads require both grants; nonpersonalized permission matrix; policy change mid-load aborts; duplicate slot IDs rejected; blocked/CSP/timeout/no-fill stable layout; refresh cap; complete teardown of iframe/listeners; keyboard/CLS/a11y checks; no ads vendor bytes in bare Core, SSR or SEO bundles. No performance or compliance guarantee is claimed by this contract-only PR.
