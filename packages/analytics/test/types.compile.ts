import { createAnalytics } from '../src/index.js';
import type { ConsentCapabilityV1, AnalyticsEventV1, AnalyticsProviderV1, AnalyticsClientV1 } from '../src/index.js';
interface Events { search: { termLength: number }; purchase: { currency: string; total: number } }
declare const consent: ConsentCapabilityV1;
declare const provider: AnalyticsProviderV1;
const analytics = createAnalytics<Events>({
  consent,
  schemas: {
    search: { fields: ['termLength'], validate: (x: unknown): x is Events['search'] =>
      typeof x === 'object' && x !== null && 'termLength' in x && typeof x.termLength === 'number' },
    purchase: { fields: ['currency','total'], validate: (x: unknown): x is Events['purchase'] =>
      typeof x === 'object' && x !== null && 'currency' in x && 'total' in x &&
      typeof x.currency === 'string' && typeof x.total === 'number' }
  },
  providers: [{ id: 'provider', purpose: 'analytics', load: () => provider }]
});
const event: AnalyticsEventV1 = { schema: 'zaakiy.analytics/1', kind: 'event', name: 'search', timestampMs: Date.now(), properties: { termLength: 4 } };
const client: AnalyticsClientV1 = analytics;
const outcome = client.track(event);
analytics.track('search', { termLength: 4 });
analytics.conversion({ name: 'purchase', goalId: 'purchase', properties: { currency: 'AED', total: 100 }, confirmed: true });
// @ts-expect-error registered events are required
analytics.track('notRegistered', { termLength: 4 });
// @ts-expect-error invalid payload shape
analytics.track('search', { rawTerm: 'sensitive' });
// @ts-expect-error conversions must be positively confirmed
analytics.conversion({ name: 'purchase', goalId: 'purchase', properties: { currency: 'AED', total: 100 }, confirmed: false });
// @ts-expect-error conversion goal is required
analytics.conversion({ name: 'purchase', properties: { currency: 'AED', total: 100 }, confirmed: true });
void outcome;
