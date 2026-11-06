/** Optional P3 privacy-aware analytics, with no default active provider. */
export { createAnalytics } from './engine.js';
export { createMemoryProvider, createHttpProvider } from './providers.js';
export type {
  EventValue, EventMetadata, EventMap, EventSchema, EventSchemas,
  ConsentCapabilityV1, ConsentReader, ConsentPurposeV1, ConsentSnapshotV1, ConsentDecisionV1, ConsentGrantV1,
  AnalyticsBaseV1, AnalyticsEventV1, ConversionEventV1, PageviewEventV1, WebVitalEventV1,
  AnalyticsRecordV1, AnalyticsRecord, EventCategory, WebVitalNameV1, WebVitalRatingV1,
  AnalyticsIdentityV1, AnalyticsProviderV1, AnalyticsProvider, ProviderDefinition, AnalyticsPolicyV1,
  AnalyticsClientV1, TrackResultV1, AnalyticsDiagnostics, IdentityPolicy, AnalyticsOptions,
  PageviewInput, ConversionInput, Analytics
} from './types.js';
export type { MemoryProvider, HttpProviderOptions } from './providers.js';
