/** Frozen P3 protocols: docs/contracts/{15-consent,16-analytics}.md */
export type EventValue = string | number | boolean | null;
export type EventMetadata = Readonly<Record<string, EventValue>>;
export type EventMap = Record<string, EventMetadata>;
export interface EventSchema<T extends EventMetadata> {
  readonly fields: readonly (keyof T & string)[];
  readonly validate: (value: unknown) => value is T;
}
export type EventSchemas<M extends { [K in keyof M]: EventMetadata }> = {
  readonly [K in keyof M]: EventSchema<M[K]>;
};
export type ConsentPurposeV1 = 'essential' | 'analytics' | 'advertising' | 'ad-personalization' | 'functional-third-party';
export type ConsentDecisionV1 = 'unknown' | 'granted' | 'denied' | 'revoked';
export interface ConsentGrantV1 {
  readonly purpose: ConsentPurposeV1;
  readonly decision: ConsentDecisionV1;
  readonly updatedAt?: string;
  readonly source?: 'user' | 'policy' | 'cmp' | 'server';
}
export interface ConsentSnapshotV1 {
  readonly schema: 'zaakiy.consent/1';
  readonly revision: number;
  readonly policyId: string;
  readonly policyVersion: string;
  readonly region?: string;
  readonly grants: Readonly<Record<ConsentPurposeV1, ConsentGrantV1>>;
}
/** Structural, injected capability; does not import or create a consent runtime. */
export interface ConsentCapabilityV1 {
  readonly schema: 'zaakiy.consent/1';
  snapshot(): ConsentSnapshotV1;
  can(purpose: ConsentPurposeV1): boolean;
  subscribe(listener: (next: ConsentSnapshotV1, previous: ConsentSnapshotV1) => void): () => void;
}
/** Historical name retained as an alias; it is NOT a second consent protocol. */
export type ConsentReader = ConsentCapabilityV1;
export type WebVitalNameV1 = 'LCP' | 'INP' | 'CLS';
export type WebVitalRatingV1 = 'good' | 'needs-improvement' | 'poor';
export interface AnalyticsBaseV1 {
  readonly schema: 'zaakiy.analytics/1';
  readonly name: string;
  readonly timestampMs: number;
  readonly properties?: EventMetadata;
  readonly dedupeKey?: string;
}
export interface AnalyticsEventV1 extends AnalyticsBaseV1 { readonly kind: 'event' }
export interface ConversionEventV1 extends AnalyticsBaseV1 {
  readonly kind: 'conversion'; readonly goalId: string; readonly value?: number; readonly currency?: string;
}
export interface PageviewEventV1 extends AnalyticsBaseV1 {
  readonly kind: 'pageview'; readonly routeId: string; readonly path: string; readonly referrerOrigin?: string;
}
export interface WebVitalEventV1 extends AnalyticsBaseV1 {
  readonly kind: 'web-vital'; readonly metric: WebVitalNameV1; readonly value: number;
  readonly rating?: WebVitalRatingV1;
  readonly navigationType?: 'navigate' | 'reload' | 'back-forward' | 'prerender';
}
export type AnalyticsRecordV1 = AnalyticsEventV1 | ConversionEventV1 | PageviewEventV1 | WebVitalEventV1;
export type AnalyticsRecord = AnalyticsRecordV1;
export type EventCategory = AnalyticsRecordV1['kind'];
export interface AnalyticsIdentityV1 {
  readonly scope: 'anonymous-ephemeral' | 'authenticated-opt-in'; readonly subject?: string;
}
/** Exactly the frozen P3 provider lifecycle. */
export interface AnalyticsProviderV1 {
  readonly version: 1;
  start(context: { readonly signal: AbortSignal; readonly identity?: AnalyticsIdentityV1 }): Promise<void>;
  send(batch: readonly AnalyticsRecordV1[], signal: AbortSignal): Promise<void>;
  flush(signal: AbortSignal): Promise<void>;
  dispose(): Promise<void> | void;
}
export type AnalyticsProvider = AnalyticsProviderV1;
export interface ProviderDefinition {
  readonly id: string;
  readonly purpose: ConsentPurposeV1;
  readonly load: () => AnalyticsProviderV1 | Promise<AnalyticsProviderV1>;
}
export interface AnalyticsPolicyV1 {
  readonly version: 1;
  readonly sampleRate: number;
  readonly maxBatchSize: number;
  readonly maxQueueSize: number;
  readonly maxPayloadBytes: number;
  readonly flushIntervalMs: number;
  readonly delivery: 'beacon-if-allowed' | 'fetch';
  readonly requiredPurposes: readonly ['analytics'];
}
export type TrackResultV1 = 'accepted' | 'blocked' | 'sampled-out' | 'invalid';
export interface AnalyticsClientV1 { track(record: AnalyticsRecordV1): TrackResultV1; flush(): Promise<void>; dispose(): Promise<void> | void }
export interface AnalyticsDiagnostics {
  readonly accepted: number; readonly dropped: number; readonly delivered: number;
  readonly errors: number; readonly queueLength: number;
}
export interface IdentityPolicy {
  readonly purpose: ConsentPurposeV1;
  readonly encode: (identity: string) => string;
  readonly retention: 'session' | 'event-only';
}
export interface AnalyticsOptions<M extends { [K in keyof M]: EventMetadata }> {
  readonly schemas: EventSchemas<M>;
  readonly consent: ConsentCapabilityV1;
  readonly providers?: readonly ProviderDefinition[];
  readonly identity?: IdentityPolicy;
  readonly policy?: AnalyticsPolicyV1;
  readonly sampleRate?: number;
  readonly maxQueueSize?: number;
  readonly batchSize?: number;
  readonly flushIntervalMs?: number;
  readonly deliveryTimeoutMs?: number;
  readonly maxRetries?: number;
  readonly retryDelayMs?: number;
  readonly onError?: (error: unknown, providerId: string) => void;
  readonly registerCleanup?: (cleanup: () => void) => void;
}
export interface PageviewInput { readonly path: string; readonly routeId: string }
export interface ConversionInput<T extends EventMetadata> {
  readonly name: string; readonly properties: T; readonly goalId: string;
  readonly value?: number; readonly currency?: string;
  readonly confirmed: true; readonly deduplicationId?: string;
}
export interface Analytics<M extends { [K in keyof M]: EventMetadata }> extends AnalyticsClientV1 {
  track<K extends keyof M & string>(name: K, properties: M[K]): boolean;
  track(record: AnalyticsRecordV1): TrackResultV1;
  pageview(page: PageviewInput): boolean;
  conversion<K extends keyof M & string>(input: ConversionInput<M[K]> & { readonly name: K }): boolean;
  identify(identity: string): boolean;
  measure(name: 'LCP' | 'INP' | 'CLS' | 'FCP' | 'TTFB', value: number, id: string, path?: string, details?: { readonly rating?: WebVitalRatingV1; readonly navigationType?: WebVitalEventV1['navigationType'] }): boolean;
  timing(name: string, durationMs: number, path?: string): boolean;
  diagnostics(): AnalyticsDiagnostics;
  readonly consent: ConsentCapabilityV1;
}
