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

`@zaakiyjs/analytics/vitals` exports `startWebVitals()` and `reportPerformanceMeasure()`. `startWebVitals()` requires an application-provided `DisposableWebVitalsSource` whose `start(callback)` returns a real observer/listener teardown function. This enables **immediate observer disposal** on consent revocation, guards against callbacks from earlier collector generations, and clean reinitialization on regrant. The host source must use a tested standard algorithm for LCP/INP/CLS; this package does **not** silently create one or import Google's `web-vitals`, whose metric callback registration does not expose per-observer disconnection. Therefore, **out-of-box Web Vitals collection is not yet provided** and browser accuracy/compatibility of a particular source cannot be claimed. Supporting FCP/TTFB and custom `Performance.measure()` reporting are optional.

LCP and INP are in milliseconds; CLS is unitless. Unsupported browser metrics are never fabricated. No library can guarantee a metric on all page loads (INP can be absent without interaction). When supplying a source, test actual Chromium/Firefox/WebKit behavior and cleanup before relying on its output.

## Validation and release restrictions

Run `pnpm --filter @zaakiyjs/analytics lint`, `typecheck`, `build`, `test`, and `pack:check`; also run root frozen-lockfile CI. Actual collector behavior requires browser tests. Independent npm installation, CSP, overhead and release provenance remain separate gates. Importing this package does not activate Ads or require SSR, Router, Consent runtime, Compiler or AI packages.
