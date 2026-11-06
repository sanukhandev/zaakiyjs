/** Optional, fail-closed consent policy runtime. No advertising/analytics imports. */
export { createConsentManager } from './manager.js';
export { createConsentActivation } from './activation.js';
export { createMemoryConsentStorage, createCookieConsentStorage, createServerSessionConsentStorage,
  decodeConsentRecord, serializeConsentRecord } from './storage.js';
export { connectCMP, mapCMPDecisions, parseVerifiedCMPMessage } from './cmp.js';
export type { ConsentStatus, ConsentReason, PurposeDefinition, PurposeDecision, ConsentRecord,
  ConsentPolicy, ConsentStorage, ConsentChange, ConsentGate, ConsentManagerOptions, ConsentManager } from './types.js';
export type { ConsentCleanup, ConsentActivationOptions, ConsentActivation, ConsentWithdrawalReason } from './activation.js';
export type { CMPAdapter, CMPDecision, CMPMapping, CMPConnection, VerifiedCMPMessageOptions } from './cmp.js';
export type { CookieJar, CookieConsentStorageOptions } from './storage.js';

export { CONSENT_SCHEMA_V1, CONSENT_PURPOSES_V1, decodeConsentSnapshotV1 } from './protocol.js';
export type { ConsentPurposeV1, ConsentDecisionV1, ConsentGrantV1, ConsentSnapshotV1, ConsentCapabilityV1, ConsentSnapshotListenerV1, ConsentPolicyAdapterV1, ConsentStorageAdapterV1, ConsentCmpAdapterV1, ConsentResourceV1 } from './protocol.js';
