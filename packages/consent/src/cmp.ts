import type { ConsentManager, ConsentReason } from './types.js';
import type { ConsentPurposeV1 } from './protocol.js';

export type CMPDecision = 'granted' | 'denied' | 'revoked';
export interface CMPAdapter {
  /** Untrusted vendor data: validate/match it before applying to the manager. */
  read(): unknown | Promise<unknown>;
  subscribe(listener: (payload: unknown) => void): () => void;
}
export interface CMPMapping<P extends ConsentPurposeV1> {
  readonly vendorToPurpose: Readonly<Record<string, P>>;
}
export interface CMPConnection { dispose(): void }
/** Strict generic mapping; no claim of IAB TCF, GPP or CMP certification. */
export function mapCMPDecisions<P extends ConsentPurposeV1>(payload: unknown, mapping: CMPMapping<P>): Partial<Record<P, CMPDecision>> {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) throw new TypeError('Malformed CMP response');
  const response = payload as Record<string, unknown>;
  const decisions = Object.create(null) as Partial<Record<P, CMPDecision>>;
  for (const [vendorPurpose, purpose] of Object.entries(mapping.vendorToPurpose)) {
    if (!Object.prototype.hasOwnProperty.call(response, vendorPurpose)) continue;
    const value = response[vendorPurpose];
    if (value !== 'granted' && value !== 'denied' && value !== 'revoked') throw new TypeError('Malformed CMP decision');
    if (decisions[purpose] !== undefined && decisions[purpose] !== value) throw new TypeError('Conflicting CMP purpose mapping');
    decisions[purpose] = value;
  }
  return decisions;
}
/** Reconcile validated CMP events without accepting unknown/malformed purpose grants. */
export function connectCMP<P extends ConsentPurposeV1>(manager: ConsentManager<P>, adapter: CMPAdapter, mapping: CMPMapping<P>, onError?: (error: unknown) => void): CMPConnection {
  let disposed = false;
  let revision = 0;
  let off: (() => void) | undefined;
  const report = (error: unknown) => { try { onError?.(error); } catch { /* ignore reporting failures */ } };
  function apply(payload: unknown): void {
    if (disposed || manager.disposed) return;
    try {
      const decisions = mapCMPDecisions(payload, mapping);
      // Validate every mapped purpose before applying any vendor decisions.
      for (const purpose of Object.keys(decisions)) manager.status(purpose as P);
      manager.applyExternalDecisions(decisions, 'cmp' satisfies ConsentReason);
    } catch (error) { report(error); }
  }
  // User decisions made after connect invalidate an in-flight initial CMP read.
  const offManager = manager.onChange(() => { revision++; });
  try { off = adapter.subscribe(payload => { revision++; apply(payload); }); }
  catch (error) { report(error); }
  const previousRevision = revision;
  void Promise.resolve().then(() => adapter.read()).then(payload => {
    if (!disposed && revision === previousRevision) apply(payload);
  }).catch(report);
  return { dispose() { if (disposed) return; disposed = true; revision++; off?.(); offManager?.(); } };
}

export interface VerifiedCMPMessageOptions {
  readonly origin: string;
  readonly source: MessageEventSource | null;
  readonly eventType: string;
}
/** A transport guard, not a vendor-specific CMP protocol implementation. */
export function parseVerifiedCMPMessage(event: MessageEvent<unknown>, options: VerifiedCMPMessageOptions): unknown | null {
  if (!options.origin || options.origin === '*' || event.origin !== options.origin ||
      options.source === null || event.source !== options.source) return null;
  if (typeof event.data !== 'object' || event.data === null || Array.isArray(event.data)) return null;
  const payload = event.data as Record<string, unknown>;
  if (payload.type !== options.eventType || !Object.prototype.hasOwnProperty.call(payload, 'decisions')) return null;
  return payload.decisions;
}
