# Contract 16 — optional analytics and conversions (P3 analytics v1)

- **Status:** Frozen **design**, no implementation or default provider.
- **Owner:** proposed `@zaakiyjs/analytics`; protocol `zaakiy.analytics/1`.
- **Dependency:** browser-safe, optional import; consumes injected `ConsentCapabilityV1` (Contract 15), **not** Consent runtime, Ads, Compiler or Router internals.

## Typed event and measurement model

~~~ts
type AnalyticsValueV1 = string | number | boolean | null;
type AnalyticsEventNameV1 = string; // app allowlist/registry validates name
interface AnalyticsBaseV1 {
  readonly schema: "zaakiy.analytics/1";
  readonly name: AnalyticsEventNameV1;
  readonly timestampMs: number;
  readonly properties?: Readonly<Record<string, AnalyticsValueV1>>;
  readonly dedupeKey?: string; // opaque, non-PII, bounded
}
interface AnalyticsEventV1 extends AnalyticsBaseV1 {
  readonly kind: "event";
}
interface ConversionEventV1 extends AnalyticsBaseV1 {
  readonly kind: "conversion";
  readonly goalId: string; readonly value?: number; readonly currency?: string;
}
interface PageviewEventV1 extends AnalyticsBaseV1 {
  readonly kind: "pageview";
  readonly routeId: string; readonly path: string; // sanitized same-origin path
  readonly referrerOrigin?: string; // origin only; no query, token or fragment
}
type WebVitalNameV1 = "LCP" | "INP" | "CLS";
interface WebVitalEventV1 extends AnalyticsBaseV1 {
  readonly kind: "web-vital";
  readonly metric: WebVitalNameV1;
  readonly value: number; // LCP/INP ms; CLS unitless
  readonly rating?: "good" | "needs-improvement" | "poor";
  readonly navigationType?: "navigate" | "reload" | "back-forward" | "prerender";
}
type AnalyticsRecordV1 = AnalyticsEventV1 | ConversionEventV1 | PageviewEventV1 | WebVitalEventV1;
interface AnalyticsProviderV1 {
  readonly version: 1;
  start(context: { readonly signal: AbortSignal; readonly identity?: AnalyticsIdentityV1 }): Promise<void>;
  send(batch: readonly AnalyticsRecordV1[], signal: AbortSignal): Promise<void>;
  flush(signal: AbortSignal): Promise<void>;
  dispose(): Promise<void> | void;
}
interface AnalyticsIdentityV1 {
  readonly scope: "anonymous-ephemeral" | "authenticated-opt-in";
  readonly subject?: string; // pseudonymous app-provided ID after policy permission
}
interface AnalyticsPolicyV1 {
  readonly version: 1; readonly sampleRate: number; // [0,1]
  readonly maxBatchSize: number; readonly maxQueueSize: number;
  readonly maxPayloadBytes: number; readonly flushIntervalMs: number;
  readonly delivery: "beacon-if-allowed" | "fetch";
  readonly requiredPurposes: readonly ("analytics")[];
}
interface AnalyticsClientV1 {
  track(record: AnalyticsRecordV1): "accepted" | "blocked" | "sampled-out" | "invalid";
  flush(): Promise<void>;
  dispose(): Promise<void> | void;
}
~~~

## Lifecycle and consent

No provider is imported or initialized merely by importing `@zaakiyjs/core` or Analytics itself. An application instantiates the optional client under a Core owner and supplies an adapter. It checks `consent.can("analytics")` **before** provider module load, collection, identity assignment, performance observers and network delivery, and rechecks on every queued send. In ``unknown`/`denied`/`revoked` states, drop events; do not persist and replay pre-consent behavior after grant. Revocation aborts outstanding I/O, clears queue/identity, disconnects Web Vitals observers and disposes the provider even if startup races; subsequent grant requires a new provider lifecycle, not resurrecting disposed handles.

Route/pageview events are emitted **after** Router has committed a navigation (`RouterOptions.onNavigate` is an existing callback), not on attempted guards, redirects or hash-only visits unless explicitly configured. Router remains owner of navigation. Never monkey-patch history, Promise or browser globals. For SSR static/HTTP access logs, server metrics are a separately configured operational service, not this browser-consent SDK.

## Privacy, sampling and delivery

Event names and property keys must match an application-configured allowlist; prohibit unvetted email, phone, free-text search, full URL/query, bearer token, cookies and sensitive identifiers. Anonymous identifiers are ephemeral and only generated post-permission; authenticated pseudonyms require a lawful policy/explicit integration. Diagnostics use fixed error codes, counts, delivery latency and coarse route IDs, not payload/identity dumps. `sampleRate` uses a documented unbiased approach (stable over approved post-consent ephemeral session if desired), bounded batching/queue, duplicate-key suppression for conversions, payload cap, exponential backoff with cancellation and endpoint allowlists. Drop-on-overflow and provider failure must not block navigation or render.

Metrics follow standard browser semantics: LCP and INP in milliseconds; CLS unitless. Respect background tab/page lifecycle and distinguish first load vs client navigation. Do not claim that browser unsupported APIs are polyfilled. Users with privacy controls/blockers must not encounter thrown render errors; `blocked` is an ordinary outcome.

## Required acceptance

Unknown -> no observers/provider calls; grant -> route-committed pageview once; duplicate conversion -> one send; sampled out -> no send; invalid PII payload -> rejected; revoke while start/send pending -> abort/flush dropped/dispose once; owner disposal -> no retained observers; blocked endpoint -> silent isolated error; no Analytics/Ads code in bare Core bundle. These are implementation gates, not existing tests.
