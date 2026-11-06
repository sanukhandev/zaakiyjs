import type { ConsentCapabilityV1, ConsentSnapshotV1, ConsentPurposeV1 } from './protocol.js';
import type { ReadonlySignal } from '@zaakiyjs/signals';
import type { OwnerScope } from '@zaakiyjs/core';

export type ConsentStatus = 'unknown' | 'granted' | 'denied' | 'revoked' | 'expired';
export type ConsentReason = 'user-grant' | 'user-deny' | 'user-revoke' | 'reject-all' | 'preferences' | 'policy-change' | 'expiry' | 'restore' | 'hydrate' | 'cmp' | 'privacy-signal';
export interface PurposeDefinition<P extends ConsentPurposeV1 = ConsentPurposeV1> { readonly id: P; readonly essential?: boolean }
export interface PurposeDecision { readonly status: ConsentStatus; readonly updatedAt: number; readonly reason: ConsentReason }
export interface ConsentRecord {
  readonly schemaVersion: 1;
  readonly policyVersion: string;
  readonly policyId?: string;
  readonly region?: string;
  readonly decidedAt: number;
  readonly expiresAt?: number;
  readonly decisions: Readonly<Record<string, PurposeDecision>>;
}
export interface ConsentPolicy {
  readonly id?: string;
  readonly version: string;
  /** Essential services require explicit deployment authorization, never an inferred grant. */
  readonly allowEssential?: boolean;
  readonly region?: string;
  readonly maxAgeMs?: number;
  readonly gpcPurposes?: readonly string[];
  readonly dntPurposes?: readonly string[];
  readonly globalPrivacyControl?: boolean;
  readonly doNotTrack?: boolean;
}
export interface ConsentStorage {
  read(): ConsentRecord | null | Promise<ConsentRecord | null>;
  write(record: ConsentRecord): void | Promise<void>;
  clear?(): void | Promise<void>;
}
export interface ConsentChange {
  readonly purpose: string;
  readonly previous: ConsentStatus;
  readonly current: ConsentStatus;
  readonly allowed: boolean;
  readonly reason: ConsentReason;
  readonly policyVersion: string;
}
export interface ConsentGate<P extends string = string> {
  isAllowed(purpose: P): boolean;
  subscribe(purpose: P, listener: (allowed: boolean) => void): () => void;
}
export interface ConsentManagerOptions<P extends ConsentPurposeV1> {
  readonly purposes: readonly (P | PurposeDefinition<P>)[];
  readonly policy?: ConsentPolicy;
  readonly defaultDecision?: 'deny';
  readonly storage?: ConsentStorage;
  /** Hydration is trusted only when constructed by the deployment's request scope. */
  readonly initialSnapshot?: { readonly trusted: true; readonly record?: ConsentRecord; readonly snapshot?: ConsentSnapshotV1 };
  readonly now?: () => number;
  readonly onError?: (error: unknown) => void;
  readonly owner?: OwnerScope;
}
export interface ConsentManager<P extends ConsentPurposeV1 = ConsentPurposeV1> extends ConsentGate<P> {
  readonly capability: ConsentCapabilityV1;
  readonly ready: Promise<void>;
  readonly states: ReadonlySignal<Readonly<Record<P, ConsentStatus>>>;
  readonly policyVersion: ReadonlySignal<string>;
  readonly disposed: boolean;
  status(purpose: P): ConsentStatus;
  grant(purposes: P | readonly P[], reason?: ConsentReason): void;
  deny(purposes: P | readonly P[], reason?: ConsentReason): void;
  revoke(purposes: P | readonly P[]): void;
  rejectAll(): void;
  updatePreferences(decisions: Readonly<Partial<Record<P, 'granted' | 'denied'>>>): void;
  /** Atomic validated event from an explicitly integrated CMP. */
  applyExternalDecisions(decisions: Readonly<Partial<Record<P, 'granted' | 'denied' | 'revoked'>>>, reason?: ConsentReason): void;
  updatePolicy(policy: ConsentPolicy): void;
  refresh(): void;
  snapshot(): ConsentRecord;
  onChange(listener: (change: ConsentChange) => void): () => void;
  flushStorage(): Promise<void>;
  dispose(): void;
}
