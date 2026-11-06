import type { ReadonlySignal } from "@zaakiyjs/signals";

/** Frozen P3-00 structural contract. No dependency on the consent runtime. */
export type ConsentPurposeV1 = "essential" | "analytics" | "advertising" | "ad-personalization" | "functional-third-party";
export type ConsentDecisionV1 = "unknown" | "granted" | "denied" | "revoked";
export interface ConsentGrantV1 {
  readonly purpose: ConsentPurposeV1;
  readonly decision: ConsentDecisionV1;
  readonly updatedAt?: string;
  readonly source?: "user" | "policy" | "cmp" | "server";
}
export interface ConsentSnapshotV1 {
  readonly schema: "zaakiy.consent/1";
  readonly revision: number;
  readonly policyId: string;
  readonly policyVersion: string;
  readonly region?: string;
  readonly grants: Readonly<Record<ConsentPurposeV1, ConsentGrantV1>>;
}
export interface ConsentCapabilityV1 {
  readonly schema: "zaakiy.consent/1";
  snapshot(): ConsentSnapshotV1;
  can(purpose: ConsentPurposeV1): boolean;
  subscribe(listener: (next: ConsentSnapshotV1, previous: ConsentSnapshotV1) => void): () => void;
}
export type AdvertisingPurposeV1 = "advertising" | "ad-personalization";
export type AdSlotStateV1 = "idle" | "awaiting-consent" | "loading" | "ready" | "blocked" | "empty" | "failed" | "revoked" | "disposed";
export interface AdSlotV1 {
  readonly schema: "zaakiy.ads/1";
  readonly id: string;
  readonly placement: string;
  readonly formats: readonly ("display" | "native" | "video")[];
  readonly dimensions: readonly { readonly width: number; readonly height: number }[];
  readonly reserve: { readonly minWidth: number; readonly minHeight: number; readonly aspectRatio?: number };
  readonly requiredPurposes: readonly AdvertisingPurposeV1[];
  readonly personalized: boolean;
}
export interface AdProviderV1 {
  readonly version: 1;
  readonly id: string;
  start(context: { readonly signal: AbortSignal; readonly scopeId: string }): Promise<void>;
  load(slot: AdSlotV1, host: HTMLElement, signal: AbortSignal): Promise<"filled" | "empty" | "blocked">;
  remove(slotId: string): Promise<void> | void;
  dispose(): Promise<void> | void;
}
export interface AdPlacementHandleV1 {
  readonly id: string;
  readonly state: ReadonlySignal<AdSlotStateV1>;
  refresh(): Promise<void>;
  dispose(): Promise<void>;
}
export interface AdPolicyV1 {
  readonly version: 1;
  readonly providerId: string;
  readonly allowPlacements: readonly string[];
  readonly requiredPurposes: readonly AdvertisingPurposeV1[];
  readonly personalized: boolean;
  readonly maxSlots: number;
  readonly loadTimeoutMs: number;
}
export interface AdProviderWithRefreshV1 extends AdProviderV1 {
  /** Explicit vendor-reviewed refresh. Never assumed from load(). */
  refresh(slot: AdSlotV1, host: HTMLElement, signal: AbortSignal): Promise<"filled" | "empty" | "blocked">;
  readonly minRefreshIntervalMs: number;
}
export interface AdPlacementOptionsV1 {
  readonly lazy?: boolean;
  readonly preloadMarginPx?: number;
  readonly label?: string;
  /** Permitted only with a refresh-capable provider; never scheduled automatically. */
  readonly refreshMinIntervalMs?: number;
}
export interface AdsEventV1 {
  readonly type: "requested" | "ready" | "empty" | "blocked" | "failed" | "revoked" | "refreshed" | "disposed";
  readonly slotId: string;
}
export interface AdsManagerOptionsV1 {
  readonly consent: ConsentCapabilityV1;
  readonly provider: AdProviderV1;
  readonly policy: AdPolicyV1;
  readonly scopeId: string;
  readonly document?: Document;
  readonly now?: () => number;
  readonly onEvent?: (event: AdsEventV1) => void;
}
export interface AdMountedPlacementV1 extends AdPlacementHandleV1 {
  mount(element: HTMLElement): void;
  load(): Promise<void>;
  pause(): void;
  resume(): void;
}
export interface AdsManagerV1 {
  readonly schema: "zaakiy.ads/1";
  register(slot: AdSlotV1, options?: AdPlacementOptionsV1): AdMountedPlacementV1;
  get(id: string): AdMountedPlacementV1 | undefined;
  dispose(): Promise<void>;
}
