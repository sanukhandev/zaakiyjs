import type { ReadonlySignal } from "@zaakiyjs/signals";

export type AdFormat = "banner" | "rectangle" | "responsive" | "in-content" | "sidebar";
export type AdMode = "personalized" | "nonpersonalized";
export type AdPhase = "registered" | "waiting-consent" | "waiting-visibility" | "loading" | "filled" | "empty" | "blocked" | "failed" | "disposed";
export type ConsentDecision = "unknown" | "granted" | "denied";

/** Provisional injection seam. Must be reconciled with the P3-00 frozen ConsentGate. */
export interface AdsConsentGate {
  check(purposes: readonly string[]): ConsentDecision;
  subscribe(listener: () => void): () => void;
}

export interface AdSize { readonly width: number; readonly height: number }
export interface ResponsiveAdSize {
  readonly minWidth: number;
  readonly size: AdSize;
}
export interface AdSlotConfig {
  readonly id: string;
  readonly providerId: string;
  readonly placement: string;
  readonly format: AdFormat;
  readonly requiredPurposes?: readonly string[];
  readonly mode: AdMode;
  readonly size?: AdSize;
  readonly responsive?: readonly ResponsiveAdSize[];
  readonly minHeight: number;
  readonly lazy?: boolean;
  readonly preloadMarginPx?: number;
  readonly refresh?: { readonly enabled: true; readonly minIntervalMs: number; readonly requireVisibility?: boolean };
  readonly routeId?: string;
  readonly persistent?: boolean;
  readonly label?: string;
}

export interface AdSlotState {
  readonly phase: AdPhase;
  readonly errorCode?: "provider-error" | "provider-blocked" | "authorization-error";
}
export interface AdLoadResult {
  /** The provider MUST confirm a fill; a successful promise is not proof of fill. */
  readonly status: "filled" | "empty" | "blocked";
  readonly impressionConfirmed?: boolean;
}
export interface AdProviderContext {
  readonly signal: AbortSignal;
  readonly mode: AdMode;
}
export interface AdRequest extends AdProviderContext {
  readonly slotId: string;
  readonly placement: string;
  readonly format: AdFormat;
  readonly element: HTMLElement;
  readonly dimensions: AdSize | undefined;
}
export interface AdProvider {
  readonly id: string;
  readonly requiredPurposes: readonly string[];
  readonly supportsRefresh: boolean;
  /** Set true only if a complete revoke/dispose/regrant cycle is safe for this SDK. */
  readonly reinitializeAfterRevocation?: boolean;
  readonly minRefreshIntervalMs?: number;
  initialize(context: AdProviderContext): Promise<void> | void;
  load(request: AdRequest): Promise<AdLoadResult> | AdLoadResult;
  refresh?(request: AdRequest): Promise<AdLoadResult> | AdLoadResult;
  unmount?(slotId: string, element: HTMLElement): Promise<void> | void;
  dispose?(): Promise<void> | void;
}

export type AdEventType = "slot-requested" | "provider-loading" | "filled" | "empty" | "blocked" | "failed" | "impression-confirmed" | "refreshed" | "disposed";
export interface AdEvent {
  readonly type: AdEventType;
  readonly slotId: string;
  readonly providerId: string;
}
export interface AdsManagerOptions {
  readonly consent: AdsConsentGate;
  readonly providers?: readonly AdProvider[];
  /** The manager only emits local events; applications own any analytics forwarding and its consent. */
  readonly onEvent?: (event: AdEvent) => void;
  readonly now?: () => number;
  readonly document?: Document;
}
export interface AdSlot {
  readonly id: string;
  readonly state: ReadonlySignal<AdSlotState>;
  mount(element: HTMLElement): void;
  load(): Promise<void>;
  refresh(): Promise<boolean>;
  pause(): void;
  resume(): void;
  dispose(): void;
}
export interface AdsManager {
  registerProvider(provider: AdProvider): void;
  registerSlot(config: AdSlotConfig): AdSlot;
  getSlot(id: string): AdSlot | undefined;
  dispose(): void;
}
