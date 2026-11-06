/** Frozen P3 transport-neutral capability protocol (Contract 15). */
export const CONSENT_SCHEMA_V1 = 'zaakiy.consent/1' as const;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;
export const CONSENT_PURPOSES_V1 = [
  'essential', 'analytics', 'advertising', 'ad-personalization', 'functional-third-party'
] as const;
export type ConsentPurposeV1 = (typeof CONSENT_PURPOSES_V1)[number];
export type ConsentDecisionV1 = 'unknown' | 'granted' | 'denied' | 'revoked';
export type ConsentSourceV1 = 'user' | 'policy' | 'cmp' | 'server';
export interface ConsentGrantV1 {
  readonly purpose: ConsentPurposeV1;
  readonly decision: ConsentDecisionV1;
  readonly updatedAt?: string;
  readonly source?: ConsentSourceV1;
}
export interface ConsentSnapshotV1 {
  readonly schema: typeof CONSENT_SCHEMA_V1;
  readonly revision: number;
  readonly policyId: string;
  readonly policyVersion: string;
  readonly region?: string;
  readonly grants: Readonly<Record<ConsentPurposeV1, ConsentGrantV1>>;
}
export type ConsentSnapshotListenerV1 = (next: ConsentSnapshotV1, previous: ConsentSnapshotV1) => void;
export interface ConsentCapabilityV1 {
  readonly schema: typeof CONSENT_SCHEMA_V1;
  snapshot(): ConsentSnapshotV1;
  can(purpose: ConsentPurposeV1): boolean;
  subscribe(listener: ConsentSnapshotListenerV1): () => void;
}
export interface ConsentPolicyAdapterV1 {
  readonly version: 1;
  readonly id: string;
  evaluate(context: {readonly region?: string; readonly appPolicy: string;
    readonly claimedAgeClass?: 'unknown' | 'adult' | 'minor'}): {
    readonly policyVersion: string;
    readonly initial: ConsentSnapshotV1;
    readonly purposesRequiringOptIn: readonly ConsentPurposeV1[];
  };
}
export interface ConsentStorageAdapterV1 {
  readonly version: 1;
  read(scope: string, signal: AbortSignal): Promise<ConsentSnapshotV1 | null>;
  write(scope: string, value: ConsentSnapshotV1, signal: AbortSignal): Promise<void>;
  clear(scope: string, signal: AbortSignal): Promise<void>;
}
export interface ConsentCmpAdapterV1 {
  readonly version: 1;
  read(): Promise<ConsentSnapshotV1 | null>;
  subscribe(listener: (snapshot: ConsentSnapshotV1) => void): () => void;
  dispose(): void;
}
export interface ConsentResourceV1 {
  readonly purposes: readonly ConsentPurposeV1[];
  revoke(reason: 'denied' | 'revoked' | 'policy-changed' | 'owner-disposed'): void | Promise<void>;
}

/** Entirely rejects untrusted revisions, fields, timestamps and unrecognized grants. */
export function decodeConsentSnapshotV1(value: unknown): ConsentSnapshotV1 | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const x = value as Record<string, unknown>;
  if (x.schema !== CONSENT_SCHEMA_V1 || !Number.isSafeInteger(x.revision) || (x.revision as number) < 0 ||
    typeof x.policyId !== 'string' || x.policyId.length < 1 || x.policyId.length > 128 ||
    typeof x.policyVersion !== 'string' || x.policyVersion.length < 1 || x.policyVersion.length > 128 ||
    (x.region !== undefined && (typeof x.region !== 'string' || x.region.length > 128)) ||
    !x.grants || typeof x.grants !== 'object' || Array.isArray(x.grants)) return null;
  const raw = x.grants as Record<string, unknown>;
  if (Object.keys(raw).length !== CONSENT_PURPOSES_V1.length) return null;
  const grants = Object.create(null) as Record<ConsentPurposeV1, ConsentGrantV1>;
  for (const purpose of CONSENT_PURPOSES_V1) {
    const item = raw[purpose];
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    const grant = item as Record<string, unknown>;
    if (grant.purpose !== purpose || !['unknown','granted','denied','revoked'].includes(String(grant.decision)) ||
      (grant.source !== undefined && !['user','policy','cmp','server'].includes(String(grant.source))) ||
      (grant.updatedAt !== undefined && (typeof grant.updatedAt !== 'string' ||
        grant.updatedAt.length > 32 || !ISO_TIMESTAMP.test(grant.updatedAt) || !Number.isFinite(Date.parse(grant.updatedAt))))) return null;
    grants[purpose] = Object.freeze({purpose, decision: grant.decision as ConsentDecisionV1,
      ...(grant.source === undefined ? {} : {source: grant.source as ConsentSourceV1}),
      ...(grant.updatedAt === undefined ? {} : {updatedAt: grant.updatedAt as string})});
  }
  return Object.freeze({schema: CONSENT_SCHEMA_V1, revision: x.revision as number,
    policyId: x.policyId, policyVersion: x.policyVersion,
    ...(x.region === undefined ? {} : {region: x.region as string}), grants: Object.freeze(grants)});
}
