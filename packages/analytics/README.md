# @zaakiyjs/analytics — optional P3 analytics

The library is an opt-in event pipeline. No provider, persistent identifier, observer, network request or browser global is activated at import. Its event and consent protocols follow the frozen P3 contracts in `docs/contracts/15-consent.md` (`zaakiy.consent/1`) and `docs/contracts/16-analytics.md` (`zaakiy.analytics/1`). It has no runtime dependency on `@zaakiyjs/consent` or vendor SDKs.

## Typed events and consent

```ts
import { createAnalytics, createMemoryProvider } from '@zaakiyjs/analytics';
import type { ConsentCapabilityV1 } from '@zaakiyjs/analytics';

interface Events { productViewed: { productId: string }; purchase: { amount: number } }
declare const consent: ConsentCapabilityV1; // application-injected
const analytics = createAnalytics<Events>({
  consent,
  schemas: {
    productViewed: { fields: ['productId'], validate: (x): x is Events['productViewed'] =>
      typeof x === 'object' && x !== null && 'productId' in x && typeof x.productId === 'string' },
    purchase: { fields: ['amount'], validate: (x): x is Events['purchase'] =>
      typeof x === 'object' && x !== null && 'amount' in x && typeof x.amount === 'number' }
  },
  providers: [{ id: 'memory', purpose: 'analytics', load: () => createMemoryProvider() }],
  registerCleanup: cleanup => { /* register against the current Core owner */ }
});
analytics.track('productViewed', { productId: 'sku_001' });
analytics.pageview({ routeId: 'product', path: '/products/:slug' });
// Only after the application has confirmed a successful conversion:
analytics.conversion({ name: 'purchase', goalId: 'checkout_success',
  properties: { amount: 50 }, confirmed: true, deduplicationId: 'order_00123' });
await analytics.flush();
await analytics.dispose();
```

`track(name, metadata)` is the typed convenience overload (boolean result). `track(record)` accepts the frozen `AnalyticsRecordV1` discriminated union and returns `accepted`, `blocked`, `sampled-out` or `invalid`. Pageviews have `routeId` and a sanitized same-origin path. Conversions have explicit `goalId` and can include an approved numeric value/currency. Custom event metadata must pass both the application validator and a required field allowlist. Scalar values, payloads, IDs, queues and retries are bounded. Do **not** register free-text, passwords, payment data, addresses or personal identifiers in analytics schemas.

Consent is fail-closed: both `consent.can('analytics')` and a granted frozen `ConsentSnapshotV1` must authorize every collection/delivery. A provider may require an additional purpose. Events are never buffered before grant. Deny/revoke aborts pending requests and flushes, drops unsent queues, resets dedupe state, disposes existing providers and prevents stale asynchronous initialization from becoming active. A subsequent grant requires a new provider lifecycle. External servers may already have received some events before revocation; server-side erasure is out of scope.

The generic HTTP provider uses `credentials: 'omit'`, `redirect: 'error'`, no credential headers and an explicit HTTPS origin allowlist. Only relative same-origin paths work without an origin allowlist. This is best-effort telemetry; do not assume exactly-once delivery, or reliable transmission on tab close. Consequential purchases should be confirmed authoritatively on the backend, and deduplication should also occur on the server.

## Router and Web Vitals

`@zaakiyjs/analytics/router` exports `trackRouter()`. It uses the public Router committed route subscription; blocked or cancelled transitions do not produce events. Initial tracking is opt-in and hydration duplicate suppression is supported via `previouslyReportedRoute`. Query/fragment secrets are removed, but applications should prefer route **templates** to avoid embedding identifiers in paths.

`@zaakiyjs/analytics/vitals` exports `startWebVitals()`, `createNativeWebVitalsSource()`, `reportPerformanceMeasure()` and pure metric regression helpers. **The default opt-in source now uses real browser `PerformanceObserver` entries** for LCP, INP and CLS; optional FCP/TTFB and custom `Performance.measure()` are supported. An application may inject another audited `DisposableWebVitalsSource` with a real observer/listener teardown contract. This implementation does not import a third-party SDK at runtime and does not create observers until `zaakiy.consent/1` has explicitly granted the `analytics` purpose.

```ts
import { startWebVitals } from '@zaakiyjs/analytics/vitals';
// Called after creating the app's optional analytics instance.
const stop = await startWebVitals(analytics, {
  path: () => location.pathname, // path templates are preferred over raw IDs
  registerCleanup: cleanup => { /* bind to app/route owner */ }
});
// `stop()` synchronously disconnects all observers and removes listeners.
```

This native source follows published browser algorithms: LCP from native largest-contentful-paint entries, CLS from the largest layout-shift session window (at most five seconds, no more than one second between shifts), and INP from native Event Timing interaction durations and the 98th-percentile longest-interaction estimator (one outlier per 50 interactions). The source keeps bounded top-ten INP candidates and disconnects on revocation/owner disposal. It uses browser support detection and never invents metrics for unsupported APIs; LCP and INP units are milliseconds, CLS is unitless. The event's standardized rating and navigation type are forwarded when available.

**Limitations:** Consent is enforced *before* performance observation. Pre-consent browser-buffered entries are excluded even if they are already present in the browser; an opt-in after LCP/FCP/TTFB occurs can therefore legitimately produce no metric. This differs from standard unconditional field-RUM instrumentation. INP can be absent without a qualifying interaction; low-latency interactions below the Event Timing observer threshold may be unavailable. Browser precision, prerendered starts, iframe content, soft navigation metrics, BFCache differences and recent browser implementations can differ from the maintained Google `web-vitals` library or CrUX. The native adapter does **not** claim exact equivalence to Google’s implementation and intentionally does not use Google’s callback interface, which exposes no observer disposer. Never combine late-consent data with unconditional CrUX datasets without disclosing that sampling bias.

`pnpm --filter @zaakiyjs/analytics test:browser` now exercises both the synthetic lifecycle fixture and a **real PerformanceObserver metrics fixture** in Chromium, Firefox and WebKit. The latter creates visual layout changes and a real slow click and asserts Chromium emits positive LCP, CLS and INP from native observations, with cross-browser graceful unsupported-metric behavior. No performance values are manufactured in that fixture. Test infrastructure must execute the actual browser matrix to establish evidence; local TypeScript compilation alone does not prove browser correctness.

## Validation and release restrictions

Run `pnpm --filter @zaakiyjs/analytics lint`, `typecheck`, `build`, `test`, and `pack:check`; also run root frozen-lockfile CI. Actual collector behavior requires browser tests. Independent npm installation, CSP, overhead and release provenance remain separate gates. Importing this package does not activate Ads or require SSR, Router, Consent runtime, Compiler or AI packages.

## Real-browser adapter fixture

`pnpm --filter @zaakiyjs/analytics test:browser` runs a three-engine Chromium/Firefox/WebKit consent and `PerformanceObserver` lifecycle fixture using pinned Playwright 1.64.1. The first fixture uses synthetic labels to test lifecycle wiring; the second checks real native LCP/INP/CLS entries generated by browser-visible interactions and layout shifts. These tests establish standards-oriented native entry processing, not exact Google `web-vitals` or CrUX equivalence. `DisposableWebVitalsSource.start` receives an `AbortSignal` so pending initialization is cancellable; it must honor it and return a synchronous disposer for created observers.
